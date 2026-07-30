/**
 * RLS policy DDL for `tenancy.organizations` — E05-T10 Section 4/7,
 * resolving the open question `OrganizationRepository`'s own port doc and
 * `docs/modules/tenancy-schema-design.md`'s "RLS attachment points"
 * section (E05-T09) both flagged: a row here *is* an organization, not
 * something scoped *to* one via `organization_id`, so
 * `org-scoped-table-policies.ts`'s generic generator doesn't apply
 * verbatim — the comparison column is `id`, not `organization_id`.
 *
 * **Decision: direct organization visibility (Option B)** — see
 * [ADR-0024](../../../../../../docs/adr/0024-tenancy-organizations-rls-direct-visibility.md)
 * and `docs/modules/tenancy-rls-design.md`'s "Visibility model" section
 * for the full trade-off analysis against membership-driven (A) and
 * hybrid (C) visibility, both of which would require a *second*,
 * currently-nonexistent session variable identifying the querying user
 * (no `app.current_user`-equivalent mechanism exists anywhere in this
 * codebase today) — introducing one is explicitly out of scope (Section
 * 3: "do not introduce a new mechanism").
 *
 * Every policy — `SELECT`, `INSERT`, and `UPDATE` alike — uses the exact
 * same predicate: `id = current_setting('app.current_org')::uuid`. This
 * is deliberate, not an oversight for `INSERT`: `OrganizationRepository`
 * (E05-T01) already generates a new `Organization`'s id via `IdGenerator`
 * *before* persistence (Architecture rule 2), and `save`'s port signature
 * (`save(context: Context, organization: Organization)`) takes a plain
 * `Context` for both creation and every later update — meaning
 * `context.organizationId` is not a reliable source for which single
 * organization a write targets even for updates. The future Postgres
 * adapter is expected to set `app.current_org` from **the aggregate's own
 * `organization.id`** (via `PostgresUnitOfWork`'s constructor parameter,
 * `packages/platform/src/infrastructure/postgres-unit-of-work.ts`) for
 * every `save` call, creation included — not from `context`. This makes
 * organization creation use the identical mechanism as every other write
 * in this system, with no special-cased bypass. See
 * `docs/modules/tenancy-rls-design.md`'s "Repository assumptions" section
 * for the full write-path walkthrough.
 *
 * **DELETE is intentionally never granted or policied**, same rationale
 * as `org-scoped-table-policies.ts`: `Organization.delete()` is a
 * soft-delete via `status = 'DELETED'`, never a physical row deletion.
 */
import { assertSafeSqlIdentifier, type TenantPolicyTarget } from "@corestack/platform";

/**
 * Deliberately a **bare** column reference (`id`), not schema/table-qualified
 * — see `org-scoped-table-policies.ts`'s `orgScopedCheck` doc comment for
 * why a qualified reference is invalid inside a `CREATE POLICY` expression.
 */
function currentOrgCheck(): string {
  return `id = current_setting('app.current_org')::uuid`;
}

/** Statements are ordered and must be executed in order. */
export function buildOrganizationsRlsDdl(target: TenantPolicyTarget): readonly string[] {
  assertSafeSqlIdentifier(target.schema, "RLS target schema name");
  assertSafeSqlIdentifier(target.table, "RLS target table name");
  assertSafeSqlIdentifier(target.appRole, "RLS target application role name");
  assertSafeSqlIdentifier(target.platformRole, "RLS target platform role name");

  const qualifiedTable = `${target.schema}.${target.table}`;
  const check = currentOrgCheck();

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
