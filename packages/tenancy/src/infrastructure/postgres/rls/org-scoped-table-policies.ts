/**
 * RLS policy DDL for a standard org-scoped tenancy table (`memberships`,
 * `invitations`) — E05-T10 Sections 3/5/6. Pure SQL-text generation, no DB
 * dependency (same discipline as `@corestack/platform`'s
 * `buildTenantIsolationDdl`, which this deliberately does not reuse
 * verbatim: that generator emits one blanket `FOR ALL` policy per role,
 * but Section 5/6 ask for per-command policies so `DELETE` can be denied
 * outright — see the module doc below).
 *
 * Session variable: `current_setting('app.current_org')` — the platform's
 * one existing, already-certified tenant-context mechanism
 * (`packages/platform/src/infrastructure/postgres-org-context.ts`,
 * `packages/platform/src/infrastructure/postgres-unit-of-work.ts`;
 * certified in `docs/security/tenant-isolation-certification.md`).
 * **Not** `app.current_organization_id`, despite that being the literal
 * variable name the E05-T10 founder directive's Section 3 names — see
 * `docs/modules/tenancy-rls-design.md`'s "Fail-closed behaviour" section
 * for why the platform's actual mechanism was used instead: Section 3's
 * own other clause ("do not introduce a new mechanism") is unambiguous
 * and already-tested, and introducing a second, differently-named
 * session variable would itself be introducing a new (parallel,
 * untested) mechanism, contradicting the very same sentence. Deliberately
 * without `current_setting`'s `missing_ok` argument, matching
 * `buildTenantIsolationDdl` exactly — an unset session throws
 * `unrecognized configuration parameter` (fail closed, loud), not a
 * silent empty result.
 *
 * **DELETE is intentionally never granted or policied for the app role**
 * on either table: no `Membership`/`Invitation` aggregate method ever
 * performs a physical `DELETE` — `Membership.remove()` and every
 * `Invitation` terminal transition (`accept`/`revoke`/`expire`) are
 * soft-deletes via a `status` column `UPDATE`. Both the missing `GRANT`
 * and the missing policy deny it (defense in depth: even a mistaken
 * future `GRANT DELETE` would still be blocked by `FORCE ROW LEVEL
 * SECURITY` finding no matching policy). Real deletion (organization
 * purge, E05-T13) is a distinct, not-yet-designed mechanism this task
 * deliberately does not pre-empt (Section 14).
 */
import { assertSafeSqlIdentifier, type TenantPolicyTarget } from "@corestack/platform";

const APP_ROLE_OPERATIONS = ["select", "insert", "update"] as const;

/**
 * Deliberately a **bare** column reference, not schema/table-qualified.
 * Inside a `CREATE POLICY` `USING`/`WITH CHECK` expression, Postgres
 * resolves column names against whatever alias (if any) the calling query
 * uses for this table — a hard-coded `schema.table.column` reference
 * either fails to resolve when the query aliases the table, or (worse,
 * confirmed empirically) gets parsed as a three-part `database.schema.object`
 * name and rejected outright ("cross-database references are not
 * implemented"). Every Postgres RLS example (including the platform's own
 * `buildTenantIsolationDdl`) uses bare column names for exactly this
 * reason.
 */
function orgScopedCheck(): string {
  return `organization_id = current_setting('app.current_org')::uuid`;
}

/** Statements are ordered and must be executed in order (mirrors `buildTenantIsolationDdl`). */
export function buildOrgScopedTableRlsDdl(target: TenantPolicyTarget): readonly string[] {
  assertSafeSqlIdentifier(target.schema, "RLS target schema name");
  assertSafeSqlIdentifier(target.table, "RLS target table name");
  assertSafeSqlIdentifier(target.appRole, "RLS target application role name");
  assertSafeSqlIdentifier(target.platformRole, "RLS target platform role name");

  const qualifiedTable = `${target.schema}.${target.table}`;
  const check = orgScopedCheck();

  return [
    `ALTER TABLE ${qualifiedTable} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${qualifiedTable} FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY ${target.table}_select ON ${qualifiedTable}
       FOR SELECT
       TO ${target.appRole}
       USING (${check})`,
    `CREATE POLICY ${target.table}_insert ON ${qualifiedTable}
       FOR INSERT
       TO ${target.appRole}
       WITH CHECK (${check})`,
    `CREATE POLICY ${target.table}_update ON ${qualifiedTable}
       FOR UPDATE
       TO ${target.appRole}
       USING (${check})
       WITH CHECK (${check})`,
    `CREATE POLICY ${target.table}_platform_full_access ON ${qualifiedTable}
       FOR ALL
       TO ${target.platformRole}
       USING (true)`,
  ];
}

/** The three app-role command names this generator ever policies. `delete` is deliberately absent — see the module doc. */
export const ORG_SCOPED_APP_ROLE_OPERATIONS = APP_ROLE_OPERATIONS;
