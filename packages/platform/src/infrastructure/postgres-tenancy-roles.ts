/**
 * Idempotent bootstrap for the two ADR-0008 tenancy roles (E03-T30.1;
 * DB §15): an application role — subject to the `tenant_isolation` RLS
 * policy — and a platform role for relay/sweeper/support-tooling access,
 * which gets its own explicit `platform_full_access` policy rather than
 * bypassing RLS. Both are `NOLOGIN`: nothing connects to Postgres directly
 * as either role today. A future connection-pooling task (E03-T40) is
 * expected to either grant `LOGIN` for a real per-role credential or use
 * `SET ROLE`/`SET LOCAL ROLE` from an already-authenticated pool
 * connection — this bootstrap only creates the roles, it does not decide
 * that connection strategy.
 *
 * `CREATE ROLE` has no `IF NOT EXISTS` clause, so idempotency is done via
 * an existence check against `pg_roles` first.
 */
import type { Sql } from "postgres";

import { assertSafeSqlIdentifier } from "../domain/sql-identifier.js";

export interface TenancyRoleNames {
  readonly appRole: string;
  readonly platformRole: string;
}

async function ensureRole(sql: Sql, roleName: string): Promise<void> {
  assertSafeSqlIdentifier(roleName, "tenancy role name");
  const existing = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${roleName}`;
  if (existing.length === 0) {
    await sql.unsafe(`CREATE ROLE ${roleName} NOLOGIN`);
  }
}

export async function ensureTenancyRoles(sql: Sql, names: TenancyRoleNames): Promise<void> {
  await ensureRole(sql, names.appRole);
  await ensureRole(sql, names.platformRole);
}
