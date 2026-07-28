/**
 * `PostgresProcessedEventStore` — the reference `ProcessedEventStore`
 * adapter (E03-T14; implements the port from E02-T03 against
 * `platform.processed_events`, DB design §3). Ships under `./postgres`
 * (ADR-0010).
 *
 * Accepts `postgres`'s `ISql` — the common supertype of `Sql` and
 * `TransactionSql` (same reasoning as E03-T11's outbox writer) — so the
 * same class serves two different atomicity postures depending on what
 * it's constructed with:
 *
 * - **Bound to a bare pool:** `markProcessed` is its own implicit
 *   transaction, separate from whatever the handler did. There is a real
 *   (small) window between a handler's effects committing and the mark
 *   persisting — a crash there redelivers an already-effectively-handled
 *   event. Fine for handlers whose own effects are independently
 *   idempotent, or where an occasional duplicate is acceptable.
 * - **Bound to an open `TransactionSql`:** if the handler performs its
 *   own writes AND calls `markProcessed` against that *same* transaction
 *   before it commits, the mark becomes truly atomic with the handler's
 *   effects — collapsing that window to zero, exactly what the kernel
 *   port's own TSDoc requires of "durable adapters." This only happens
 *   when the caller explicitly wires it this way; the generic
 *   `idempotentHandler` wrapper (kernel) calls `handler` and
 *   `markProcessed` as two separate steps and cannot provide this
 *   guarantee by itself — see the component spec for the full nuance.
 */
import type { ProcessedEventStore } from "@corestack/kernel";
import type { ISql } from "postgres";

export class PostgresProcessedEventStore implements ProcessedEventStore {
  readonly #sql: ISql;

  constructor(sql: ISql) {
    this.#sql = sql;
  }

  async hasProcessed(consumer: string, eventId: string): Promise<boolean> {
    const rows = await this.#sql`
      SELECT 1 FROM platform.processed_events WHERE consumer = ${consumer} AND event_id = ${eventId}
    `;
    return rows.length > 0;
  }

  async markProcessed(consumer: string, eventId: string): Promise<void> {
    await this.#sql`
      INSERT INTO platform.processed_events (consumer, event_id, processed_at)
      VALUES (${consumer}, ${eventId}, now())
      ON CONFLICT (consumer, event_id) DO NOTHING
    `;
  }
}
