/**
 * `PostgresOutboxRelayStore` — the reference `OutboxRelayStore` adapter
 * (E03-T12). Ships under `./postgres` (ADR-0010).
 *
 * The cursor comparison is a genuine row-value comparison —
 * `WHERE (occurred_at, id) > ($1, $2)` — not `occurred_at > $1 AND id > $2`,
 * which would silently skip events sharing the same `occurred_at` whose
 * `id` sorts lower than the checkpoint's `id`. This is exactly what
 * `outbox_occurred_at_id_idx` (E03-T10) exists to serve.
 */
import type { DomainEvent } from "@corestack/kernel";
import type { Sql } from "postgres";

import { fromOutboxRow, type OutboxTableRow } from "../domain/outbox-event.js";
import type { OutboxRelayStore, RelayCursor } from "../application/outbox-relay.js";

export class PostgresOutboxRelayStore implements OutboxRelayStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async getCheckpoint(consumer: string): Promise<RelayCursor | null> {
    const rows = await this.#sql<{ last_occurred_at: Date; last_event_id: string }[]>`
      SELECT last_occurred_at, last_event_id
      FROM platform.outbox_checkpoints
      WHERE consumer = ${consumer}
    `;
    const row = rows[0];
    return row === undefined ? null : { occurredAt: row.last_occurred_at, id: row.last_event_id };
  }

  async fetchBatch(after: RelayCursor | null, limit: number): Promise<readonly DomainEvent[]> {
    const rows =
      after === null
        ? await this.#sql<OutboxTableRow[]>`
            SELECT id, event_name, event_version, occurred_at, organization_id,
                   actor_type, actor_id, correlation_id, causation_id, payload
            FROM platform.outbox
            ORDER BY occurred_at, id
            LIMIT ${limit}
          `
        : await this.#sql<OutboxTableRow[]>`
            SELECT id, event_name, event_version, occurred_at, organization_id,
                   actor_type, actor_id, correlation_id, causation_id, payload
            FROM platform.outbox
            WHERE (occurred_at, id) > (${after.occurredAt}::timestamptz, ${after.id}::uuid)
            ORDER BY occurred_at, id
            LIMIT ${limit}
          `;
    return rows.map(fromOutboxRow);
  }

  async advanceCheckpoint(consumer: string, cursor: RelayCursor): Promise<void> {
    await this.#sql`
      INSERT INTO platform.outbox_checkpoints (consumer, last_occurred_at, last_event_id, updated_at)
      VALUES (${consumer}, ${cursor.occurredAt}, ${cursor.id}, now())
      ON CONFLICT (consumer) DO UPDATE SET
        last_occurred_at = EXCLUDED.last_occurred_at,
        last_event_id = EXCLUDED.last_event_id,
        updated_at = EXCLUDED.updated_at
    `;
  }

  /**
   * E03-T23's readiness backlog check — same row-value cursor comparison as
   * `fetchBatch`, counted rather than fetched. The checkpoint lookup and the
   * count are folded into a single statement (rather than `getCheckpoint()`
   * followed by a second query) so a concurrent `advanceCheckpoint` between
   * the two reads can't produce a count relative to an already-stale cursor.
   */
  async countBacklog(consumer: string): Promise<number> {
    const rows = await this.#sql<{ count: string }[]>`
      SELECT count(*) FROM platform.outbox o
      WHERE (o.occurred_at, o.id) > COALESCE(
        (SELECT (last_occurred_at, last_event_id) FROM platform.outbox_checkpoints WHERE consumer = ${consumer}),
        ('-infinity'::timestamptz, '00000000-0000-0000-0000-000000000000'::uuid)
      )
    `;
    return Number(rows[0]?.count ?? 0);
  }
}
