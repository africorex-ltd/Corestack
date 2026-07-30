import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Builds a `column IN (...)` SQL expression from a small,
 * compile-time-known list of literal identifiers — never user input, so
 * inlining via `sql.raw` is safe. Two uses in this schema:
 *
 * - **`CHECK` constraints** on enum-shaped `text` columns (ADR-0023:
 *   enums here are CHECK-constrained `text`, not native Postgres `ENUM`
 *   types) — `values` is the column's full enum value set.
 * - **Partial-index `WHERE` predicates** (e.g. `memberships`' active-
 *   membership uniqueness rule) — `values` is a single-element list
 *   naming the one status the index applies to.
 *
 * Deliberately renders the column as a **bare** identifier
 * (`sql.raw(column.name)`), not by interpolating the column object
 * (`${column}`) directly. Drizzle's own SQL serializer renders an
 * interpolated column reference fully schema/table-qualified
 * (`"schema"."table"."column"`) in this context — invalid inside a
 * `CREATE TABLE` `CHECK` constraint or an index `WHERE` predicate, where
 * only a bare column name is a valid reference to the row being
 * evaluated (confirmed via `drizzle-kit generate`'s own output,
 * see E05-T10's migration-generation notes and
 * `packages/tenancy/src/infrastructure/postgres/rls/`'s own generators,
 * which hit the identical issue for `CREATE POLICY` predicates).
 */
export function sqlInList(column: AnyPgColumn, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value}'`).join(", ");
  return sql`${sql.raw(column.name)} in (${sql.raw(list)})`;
}
