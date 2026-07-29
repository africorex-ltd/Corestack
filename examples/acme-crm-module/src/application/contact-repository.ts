import type { OrgScopedContext } from "@corestack/platform";
import type { Sql, TransactionSql } from "postgres";

import type { Contact, CreateContactInput } from "../domain/contact.js";

/**
 * `OrgScopedContext` on every method is a compile-time guarantee (not a
 * runtime check) that this repository can never be called without a
 * server-verified organization scope — step 4 of
 * docs/security/how-to-build-a-tenant-safe-feature.md.
 *
 * `create` and `list` have deliberately different transactional shapes,
 * matching T40's transaction-ownership rule (`unit-of-work.md`):
 * - `create` takes the open transaction's own `TransactionSql` directly —
 *   it must be called from inside a `PostgresUnitOfWork.run()` callback,
 *   which has already set `app.current_org` for the whole transaction.
 *   Calling `runOrgScopedQuery` here would attempt to nest a second
 *   transaction (`TransactionSql` has no `.begin()` — the certification's
 *   nested-`UnitOfWork` regression test proves this fails loudly).
 * - `list` is a standalone read with no enclosing transaction, so it opens
 *   and org-scopes its own via `runOrgScopedQuery`.
 */
export interface ContactRepository {
  create(
    tx: TransactionSql,
    context: OrgScopedContext,
    input: CreateContactInput,
    id: string,
  ): Promise<Contact>;

  list(sql: Sql, context: OrgScopedContext): Promise<readonly Contact[]>;
}
