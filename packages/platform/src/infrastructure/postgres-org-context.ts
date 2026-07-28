/**
 * Transaction-scoped org-context setter (E03-T30.3; DB §15; ADR-0008
 * layer 3 — "the reference Postgres adapter sets `app.current_org` per
 * transaction from the request `Context`"). Every repository adapter
 * that queries a tenant-owned table under the `tenant_isolation` RLS
 * policy (`tenant-policy.ts`) must run its queries through this wrapper.
 *
 * Uses `set_config('app.current_org', $1, true)` — a regular parameterized
 * query, not `SET LOCAL app.current_org = $1`. Verified empirically:
 * `SET LOCAL` does not accept a bind parameter and postgres.js's tagged
 * template rejects it with a syntax error (`syntax error at or near "$1"`)
 * before the statement even reaches this abstraction. `set_config`'s third
 * argument (`is_local = true`) gives the same transaction-scoped-only
 * behavior `SET LOCAL` would, through an ordinary parameterized call.
 */
import type { Sql, TransactionSql } from "postgres";

export async function withOrgContext<T>(
  sql: Sql,
  organizationId: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  // postgres.js types `.begin`'s return as `Promise<UnwrapPromiseArray<T>>`,
  // which TS cannot verify is assignable back to our own `T` for a generic
  // callback — the cast is a type-level artifact of that library signature,
  // not a runtime behavior change (`begin` always resolves to whatever the
  // callback returned).
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_org', ${organizationId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
