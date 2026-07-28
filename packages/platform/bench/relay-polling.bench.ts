/**
 * Benchmark: relay polling (E03-T12). Measures one full
 * OutboxRelay.pollOnce() round end-to-end against real Postgres:
 * checkpoint read, fetchBatch, handler dispatch (no-op handler, isolating
 * the relay/store overhead from consumer-side work — see
 * relay-dispatch.bench.ts for dispatch-loop-only overhead), and
 * checkpoint advance. No threshold assertions — see
 * docs/quality/architecture-benchmarks/outbox-benchmark-methodology.md.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createContext, createEvent, FixedClock, UuidGenerator } from "@corestack/kernel";
import type { DomainEvent, EventSubscription } from "@corestack/kernel";
import postgres, { type Sql } from "postgres";

import { OutboxRelay } from "../src/application/outbox-relay.js";
import { ensureOutboxSchema } from "../src/infrastructure/postgres-outbox-schema.js";
import { writeOutboxEvents } from "../src/infrastructure/postgres-outbox-writer.js";
import { PostgresOutboxRelayStore } from "../src/infrastructure/postgres-outbox-relay-store.js";
import { measure, writeBaseline } from "./harness.js";

let container: StartedPostgreSqlContainer;
let sql: Sql;

const ids = new UuidGenerator();
let seq = 0;

function makeBatch(size: number): DomainEvent[] {
  return Array.from({ length: size }, () => {
    seq += 1;
    const clock = new FixedClock(new Date(Date.UTC(2026, 6, 15, 12, 0, seq)));
    const context = createContext({ actor: { type: "system", id: null } }, ids);
    return createEvent({ name: "tenancy.member.invited", version: 1, payload: { seq } }, context, {
      clock,
      ids,
    });
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri(), { max: 5, onnotice: () => {} });
}, 120_000);

afterAll(async () => {
  await sql?.end();
  await container?.stop();
});

beforeEach(async () => {
  await sql.unsafe(`DROP SCHEMA IF EXISTS platform CASCADE`);
  await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") });
  seq = 0;
});

describe("bench: relay polling", () => {
  it("polls a batch of 10 fresh events once per iteration", async () => {
    const store = new PostgresOutboxRelayStore(sql);
    const subscription: EventSubscription = {
      consumer: "bench-consumer",
      event: "tenancy.member.invited",
      handler: () => {
        // No-op: isolates relay/store overhead from consumer work.
      },
    };
    const relay = new OutboxRelay({
      store,
      subscriptions: [subscription],
      batchSize: 10,
      pollIntervalMs: 1000,
    });

    const stats = await measure(
      "relay-poll-once-batch-10",
      async () => {
        await relay.pollOnce();
      },
      {
        iterations: 50,
        warmup: 5,
        setup: async () => {
          await writeOutboxEvents(sql, makeBatch(10));
        },
      },
    );
    writeBaseline(stats);
  }, 120_000);
});
