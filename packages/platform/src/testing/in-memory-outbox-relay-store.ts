/**
 * In-memory `OutboxRelayStore` test double (E03-T12). Lets the relay's
 * orchestration logic (per-consumer cursors, batching, stop-on-failure
 * checkpoint advancement) be tested without a real database. Real
 * `(occurredAt, id)` row-value cursor semantics against a genuinely
 * partitioned table are verified against Postgres in the integration
 * suite.
 */
import type { DomainEvent } from "@corestack/kernel";

import type { OutboxRelayStore, RelayCursor } from "../application/outbox-relay.js";

function compareCursor(a: DomainEvent, b: RelayCursor): number {
  const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class InMemoryOutboxRelayStore implements OutboxRelayStore {
  readonly #events: DomainEvent[] = [];
  readonly #checkpoints = new Map<string, RelayCursor>();

  /** Seed the outbox with events, already in publish order. */
  seed(...events: DomainEvent[]): void {
    this.#events.push(...events);
  }

  async getCheckpoint(consumer: string): Promise<RelayCursor | null> {
    return this.#checkpoints.get(consumer) ?? null;
  }

  async fetchBatch(after: RelayCursor | null, limit: number): Promise<readonly DomainEvent[]> {
    const sorted = [...this.#events].sort((a, b) => {
      const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
      return byTime !== 0 ? byTime : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const remaining =
      after === null ? sorted : sorted.filter((event) => compareCursor(event, after) > 0);
    return remaining.slice(0, limit);
  }

  async advanceCheckpoint(consumer: string, cursor: RelayCursor): Promise<void> {
    this.#checkpoints.set(consumer, cursor);
  }
}
