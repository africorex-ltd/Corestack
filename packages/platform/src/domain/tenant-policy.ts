/**
 * RLS tenant-isolation policy template (E03-T30.2; DB §15; ADR-0008 layer 3).
 * Pure SQL-text generation — no DB dependency, so the template itself is
 * unit-testable without a live connection.
 *
 * Two policies per table, scoped to two different roles (DB §15's "separate
 * policy role for platform-scoped access... that is _not_ the web
 * application's role"):
 *
 * - `tenant_isolation`, `TO <appRole>`: `organization_id =
 *   current_setting('app.current_org')::uuid` — deliberately **without**
 *   `current_setting`'s `missing_ok` argument. Verified empirically against
 *   PostgreSQL 18: a connection that never called `set_config` in this
 *   session throws `unrecognized configuration parameter`; a pooled
 *   connection reused after a prior transaction set the value throws
 *   `invalid input syntax for type uuid` on the empty-string reset value.
 *   Both are hard failures, not silent wrong-tenant reads or silent empty
 *   results — the app role's queries fail loudly if `withOrgContext`
 *   (T30.3) wasn't used, rather than a forgotten call quietly returning
 *   every tenant's rows or looking like a legitimate "no results."
 * - `platform_full_access`, `TO <platformRole>`: `USING (true)` — the
 *   platform-scoped role (relay, sweepers, support tooling) gets its own
 *   explicit permissive policy rather than relying on unset-config
 *   fall-through, which the finding above shows is not a consistent no-op.
 *
 * Both policies require `FORCE ROW LEVEL SECURITY` in addition to `ENABLE
 * ROW LEVEL SECURITY` — otherwise the table's *owner* (whichever role ran
 * the `CREATE TABLE`) bypasses RLS entirely, and neither policy is ever
 * evaluated for it.
 */
import { assertSafeSqlIdentifier } from "./sql-identifier.js";

export interface TenantPolicyTarget {
  readonly schema: string;
  readonly table: string;
  readonly appRole: string;
  readonly platformRole: string;
}

/** Statements are ordered and must be executed in order (each depends on the table existing / RLS being enabled first). */
export function buildTenantIsolationDdl(target: TenantPolicyTarget): readonly string[] {
  assertSafeSqlIdentifier(target.schema, "tenant policy schema name");
  assertSafeSqlIdentifier(target.table, "tenant policy table name");
  assertSafeSqlIdentifier(target.appRole, "tenant policy application role name");
  assertSafeSqlIdentifier(target.platformRole, "tenant policy platform role name");

  const qualifiedTable = `${target.schema}.${target.table}`;

  return [
    `ALTER TABLE ${qualifiedTable} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${qualifiedTable} FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON ${qualifiedTable}
       TO ${target.appRole}
       USING (organization_id = current_setting('app.current_org')::uuid)`,
    `CREATE POLICY platform_full_access ON ${qualifiedTable}
       TO ${target.platformRole}
       USING (true)`,
  ];
}
