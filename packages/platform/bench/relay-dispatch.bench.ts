/**
 * Benchmark: relay dispatch loop (E03-T12). Unlike relay-polling.bench.ts,
 * this isolates the relay's own per-event dispatch overhead (matching,
 * handler invocation, cursor tracking) from real Postgres I/O by backing
 * it with an in-memory OutboxRelayStore — the same fake shape used by the
 * package's own unit tests. No threshold assertions — see
 * docs/quality/architecture-benchmarks/outbox-benchmark-methodology.md.
 */
import { beforeEach, describe, it } from "vitest";
import { createContext, createEvent, FixedClock, UuidGenerator } from "@corestack/kernel";
import type { DomainEvent, EventSubscription } from "@corestack/kernel";

import {
  OutboxRelay,
  type OutboxRelayStore,
  type RelayCursor,
} from "../src/application/outbox-relay.js";
import { measure, writeBaseline } from "./harness.js";

const ids = new UuidGenerator();

function makeBatch(size: number, startSeq: number): DomainEvent[] {
  return Array.from({ length: size }, (_, i) => {
    const seq = startSeq + i;
    const clock = new FixedClock(new Date(Date.UTC(2026, 6, 15, 12, 0, seq)));
    const context = createContext({ actor: { type: "system", id: null } }, ids);
    return createEvent({ name: "tenancy.member.invited", version: 1, payload: { seq } }, context, {
      clock,
      ids,
    });
  });
}

class InMemoryRelayStore implements OutboxRelayStore {
  #events: DomainEvent[] = [];
  #checkpoint: RelayCursor | null = null;

  seed(events: readonly DomainEvent[]): void {
    this.#events = [...this.#events, ...events];
  }

  async getCheckpoint(): Promise<RelayCursor | null> {
    return this.#checkpoint;
  }

  async fetchBatch(after: RelayCursor | null, limit: number): Promise<readonly DomainEvent[]> {
    // Synthetic events always have a strictly increasing, unique
    // `occurredAt` (see makeBatch), so a plain timestamp comparison is a
    // correct cursor here — unlike the real Postgres store, which needs
    // the full `(occurredAt, id)` row-value comparison to break ties on a
    // shared timestamp (see outbox-relay.md).
    const startIndex =
      after === null ? 0 : this.#events.findIndex((e) => e.occurredAt > after.occurredAt) + 1;
    return this.#events.slice(startIndex, startIndex + limit);
  }

  async advanceCheckpoint(_consumer: string, cursor: RelayCursor): Promise<void> {
    this.#checkpoint = cursor;
  }
}

let store: InMemoryRelayStore;
let seq = 0;

beforeEach(() => {
  store = new InMemoryRelayStore();
  seq = 0;
});

describe("bench: relay dispatch loop", () => {
  it("dispatches a batch of 10 fresh events per iteration, in-memory store", async () => {
    const subscription: EventSubscription = {
      consumer: "bench-consumer",
      event: "tenancy.member.invited",
      handler: () => {
        // No-op: the point is measuring the relay's own loop overhead.
      },
    };
    const relay = new OutboxRelay({
      store,
      subscriptions: [subscription],
      batchSize: 10,
      pollIntervalMs: 1000,
    });

    const stats = await measure(
      "relay-dispatch-batch-10-in-memory",
      async () => {
        await relay.pollOnce();
      },
      {
        iterations: 200,
        warmup: 20,
        setup: async () => {
          store.seed(makeBatch(10, seq));
          seq += 10;
        },
      },
    );
    writeBaseline(stats);
  });
});
