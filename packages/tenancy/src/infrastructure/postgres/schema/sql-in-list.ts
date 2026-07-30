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
 */
export function sqlInList(column: AnyPgColumn, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value}'`).join(", ");
  return sql`${column} in (${sql.raw(list)})`;
}
