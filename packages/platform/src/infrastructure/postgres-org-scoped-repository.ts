/**
 * Org-scoped repository query helper (E03-T31; ADR-0008 layers 1+3).
 * Thin wrapper over `withOrgContext` (E03-T30) that takes an
 * `OrgScopedContext` instead of a raw string — a raw string is just data
 * any caller could construct or copy-paste; requiring the narrowed context
 * type means a repository adapter can only reach this helper via
 * `requireOrgScoped`'s one runtime check (or an already-narrowed context
 * passed down the call chain), not by fabricating an org id inline.
 */
import type { Sql, TransactionSql } from "postgres";

import type { OrgScopedContext } from "../application/org-scoped-context.js";
import { withOrgContext } from "./postgres-org-context.js";

export async function runOrgScopedQuery<T>(
  sql: Sql,
  context: OrgScopedContext,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return withOrgContext(sql, context.organizationId, fn);
}
