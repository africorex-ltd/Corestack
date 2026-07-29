/**
 * `PostgresUnitOfWork` — the reference `UnitOfWork` adapter (E03-T40;
 * ADR-0009). Ships under `./postgres` (ADR-0010).
 *
 * Implements the kernel's `UnitOfWork` port exactly: one transaction per
 * `run()` call, staged events (`TransactionContext.publish`) flushed into
 * `platform.outbox` (E03-T11's `createOutboxStaging`/`writeOutboxEvents`)
 * atomically with whatever else `work` did, before commit. Unlike
 * `InMemoryUnitOfWork`, this adapter never calls an `EventBus` directly —
 * dispatch to actual subscribers is the outbox relay's job (E03-T12),
 * running later and asynchronously against the durably-committed rows.
 * That means "consumer failures never fail the producer" (AUD-03) holds
 * trivially here: no consumer code ever runs inside `run()` at all.
 *
 * Also sets `app.current_org` (ADR-0008 layer 3) for the transaction's
 * duration when constructed with a non-null `organizationId` — the
 * `UnitOfWork` is the transaction owner (kernel's own doc: "a use case is
 * the transaction boundary"), so it, not a separately-opened
 * `withOrgContext`/`runOrgScopedQuery` call, is the right place to set the
 * RLS context. See `docs/unit-of-work.md`'s "Transaction ownership" section
 * for the rule on when to use which.
 *
 * `PostgresTransactionContext` extends the kernel's `TransactionContext`
 * with a `sql: TransactionSql` field — the kernel port's `publish`-only
 * shape has no way for a use case's own repository calls to reach the
 * same open transaction, which would make this adapter useless for
 * anything beyond staging events. Additive on the concrete adapter only
 * (kernel's own `TransactionContext` type is untouched), the same class
 * of extension as E03-T23's optional `countBacklog` port member.
 */
import type { TransactionContext, UnitOfWork } from "@corestack/kernel";
import type { Sql, TransactionSql } from "postgres";

import { createOutboxStaging } from "./postgres-outbox-writer.js";

export interface PostgresTransactionContext extends TransactionContext {
  readonly sql: TransactionSql;
}

export class PostgresUnitOfWork implements UnitOfWork {
  readonly #sql: Sql;
  readonly #organizationId: string | null;

  constructor(sql: Sql, organizationId: string | null = null) {
    this.#sql = sql;
    this.#organizationId = organizationId;
  }

  async run<T>(work: (tx: PostgresTransactionContext) => Promise<T>): Promise<T> {
    // postgres.js types `.begin`'s return as `Promise<UnwrapPromiseArray<T>>`,
    // which TS cannot verify is assignable back to our own generic `T` — the
    // cast is a type-level artifact of that library signature (see
    // postgres-org-context.ts's identical note), not a runtime behavior
    // change.
    return this.#sql.begin(async (tx) => {
      if (this.#organizationId !== null) {
        await tx`SELECT set_config('app.current_org', ${this.#organizationId}, true)`;
      }

      const staging = createOutboxStaging();
      const result = await work({ publish: staging.tx.publish, sql: tx });
      await staging.flush(tx);
      return result;
    }) as Promise<T>;
  }
}
