/**
 * Postgres outbox writer (E03-T11; ADR-0009). Ships under `./postgres`
 * (ADR-0010).
 *
 * `writeOutboxEvents` inserts a batch of staged domain events into
 * `platform.outbox` (E03-T10) using whatever `ISql` handle the caller
 * passes — typically a `TransactionSql` from inside `sql.begin(...)`, so
 * the insert commits or rolls back atomically with whatever else that
 * transaction does. `ISql` is the interface `Sql` and `TransactionSql`
 * both extend (verified against `postgres`'s own type definitions), so
 * this one function serves both a bare pool and an open transaction
 * without the caller needing two code paths.
 *
 * This adapter deliberately does not open or manage the transaction
 * itself — the transaction boundary (and the real `UnitOfWork.run`
 * implementation that owns it) is E03-T40's job, not this task's. T11
 * only guarantees that, *given* a transaction, publishing events into it
 * is atomic and correct; `createOutboxStaging` below is the seam T40 (or
 * any other real `UnitOfWork` adapter) wires into.
 */
import type { DomainEvent, TransactionContext } from "@corestack/kernel";
import type { ISql, JSONValue } from "postgres";

import { toOutboxRow } from "../domain/outbox-event.js";

export async function writeOutboxEvents(sql: ISql, events: readonly DomainEvent[]): Promise<void> {
  if (events.length === 0) return;
  // `OutboxEventRow.payload` is deliberately `unknown` in the pure domain
  // mapping (it's not this layer's job to constrain what a use case may
  // publish); narrowed to `JSONValue` only here, where `postgres.js`'s
  // typings require it to serialize the column as jsonb.
  const rows = events.map((event) => {
    const row = toOutboxRow(event);
    return { ...row, payload: row.payload as JSONValue };
  });
  await sql`INSERT INTO platform.outbox ${sql(rows)}`;
}

export interface OutboxStaging {
  /**
   * Satisfies the kernel's `UnitOfWork.TransactionContext` port exactly
   * (`publish` only) — pass this to a use case unchanged; it has no idea
   * it's talking to Postgres.
   */
  readonly tx: TransactionContext;
  /** Flush every staged event into `platform.outbox` via `sql`. */
  flush(sql: ISql): Promise<void>;
}

/**
 * Bridges `TransactionContext.publish` to `writeOutboxEvents`: a use case
 * stages events through `tx.publish(...)` exactly as the kernel port
 * specifies, and the caller (a real `UnitOfWork` implementation) flushes
 * the staged batch into the same open Postgres transaction before commit.
 */
export function createOutboxStaging(): OutboxStaging {
  const staged: DomainEvent[] = [];
  return {
    tx: {
      publish: (...events) => {
        staged.push(...events);
      },
    },
    flush: (sql) => writeOutboxEvents(sql, staged),
  };
}
