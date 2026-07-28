/**
 * Real-Postgres integration tests for E03-T12 (Testcontainers). Proves the
 * relay's actual contract: "no event skipped across restart" only means
 * something if state is truly discarded and rebuilt from the durable
 * checkpoint, and the `(occurred_at, id)` row-value cursor comparison
 * matters most exactly when two events share the same `occurred_at`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createContext,
  createEvent,
  FixedClock,
  UuidGenerator,
  type DomainEvent,
  type EventSubscription,
} from "@corestack/kernel";
import postgres, { type Sql } from "postgres";

import { OutboxRelay } from "../../src/application/outbox-relay.js";
import { ensureOutboxSchema } from "../../src/infrastructure/postgres-outbox-schema.js";
import { writeOutboxEvents } from "../../src/infrastructure/postgres-outbox-writer.js";
import { PostgresOutboxRelayStore } from "../../src/infrastructure/postgres-outbox-relay-store.js";

let container: StartedPostgreSqlContainer;
let sql: Sql;

const ids = new UuidGenerator();

function makeEvent(name: string, occurredAt: Date, payload: unknown = {}): DomainEvent {
  const clock = new FixedClock(occurredAt);
  const context = createContext({ actor: { type: "system", id: null } }, ids);
  return createEvent({ name, version: 1, payload }, context, { clock, ids });
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
});

describe("OutboxRelay (E03-T12 integration)", () => {
  it("delivers no events skipped across a full restart: fresh relay + store instance resumes from the durable checkpoint", async () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      makeEvent("tenancy.member.invited", new Date(Date.UTC(2026, 6, 15, 12, 0, i)), {
        seq: i + 1,
      }),
    );
    await writeOutboxEvents(sql, events);

    const delivered: number[] = [];
    const subscription: EventSubscription = {
      consumer: "audit",
      event: "tenancy.member.invited",
      handler: (event) => {
        delivered.push((event.payload as { seq: number }).seq);
      },
    };

    // "Restart" #1: a relay instance processes half the backlog, then is
    // discarded entirely (no in-memory state survives).
    {
      const store = new PostgresOutboxRelayStore(sql);
      const relay = new OutboxRelay({
        store,
        subscriptions: [subscription],
        batchSize: 3,
        pollIntervalMs: 1000,
      });
      await relay.pollOnce();
    }

    expect(delivered).toEqual([1, 2, 3, 4, 5, 6]);

    // A brand-new relay + store, reading only the durable checkpoint,
    // must not redeliver anything already fully processed.
    const secondDelivered: number[] = [];
    const secondSubscription: EventSubscription = {
      consumer: "audit",
      event: "tenancy.member.invited",
      handler: (event) => {
        secondDelivered.push((event.payload as { seq: number }).seq);
      },
    };
    const freshStore = new PostgresOutboxRelayStore(sql);
    const freshRelay = new OutboxRelay({
      store: freshStore,
      subscriptions: [secondSubscription],
      pollIntervalMs: 1000,
    });
    await freshRelay.pollOnce();

    expect(secondDelivered).toEqual([]);
  });

  it("redelivers only the failed event onward after a crash mid-batch, proven with a fresh relay instance", async () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent("tenancy.member.invited", new Date(Date.UTC(2026, 6, 15, 12, 0, i)), {
        seq: i + 1,
      }),
    );
    await writeOutboxEvents(sql, events);

    const delivered: number[] = [];
    const subscription: EventSubscription = {
      consumer: "audit",
      event: "tenancy.member.invited",
      handler: (event) => {
        const seq = (event.payload as { seq: number }).seq;
        if (seq === 3) throw new Error("simulated crash mid-batch");
        delivered.push(seq);
      },
    };

    const store = new PostgresOutboxRelayStore(sql);
    const relay = new OutboxRelay({ store, subscriptions: [subscription], pollIntervalMs: 1000 });
    await relay.pollOnce();
    expect(delivered).toEqual([1, 2]);

    // Fresh relay + store + subscription whose handler no longer fails —
    // simulates a redeploy after fixing the bug that caused event 3 to throw.
    const recoveredDelivered: number[] = [];
    const recoveredSubscription: EventSubscription = {
      consumer: "audit",
      event: "tenancy.member.invited",
      handler: (event) => {
        recoveredDelivered.push((event.payload as { seq: number }).seq);
      },
    };
    const freshStore = new PostgresOutboxRelayStore(sql);
    const freshRelay = new OutboxRelay({
      store: freshStore,
      subscriptions: [recoveredSubscription],
      pollIntervalMs: 1000,
    });
    await freshRelay.pollOnce();

    expect(recoveredDelivered).toEqual([3, 4, 5]);
  });

  it("the (occurred_at, id) row-value cursor never skips an event sharing the exact same occurred_at as the checkpoint", async () => {
    // Two events at the identical instant; deliberately insert them so the
    // second one's uuid sorts LOWER than the first's — a naive
    // `occurred_at > $1 AND id > $2` predicate would drop it.
    const sameInstant = new Date("2026-07-15T12:00:00.000Z");
    let first = makeEvent("tenancy.member.invited", sameInstant, { label: "first" });
    let second = makeEvent("tenancy.member.invited", sameInstant, { label: "second" });
    if (second.id > first.id) {
      [first, second] = [second, first];
    }
    expect(second.id < first.id).toBe(true);
    await writeOutboxEvents(sql, [first, second]);

    const delivered: string[] = [];
    const subscription: EventSubscription = {
      consumer: "audit",
      event: "tenancy.member.invited",
      handler: (event) => {
        delivered.push((event.payload as { label: string }).label);
      },
    };

    const store = new PostgresOutboxRelayStore(sql);
    const relay = new OutboxRelay({
      store,
      subscriptions: [subscription],
      batchSize: 1,
      pollIntervalMs: 1000,
    });
    await relay.pollOnce();
    await relay.pollOnce();

    expect(delivered.sort()).toEqual(["first", "second"]);
  });

  it("drain() lets an in-flight round finish and its checkpoint persist before returning", async () => {
    const events = Array.from({ length: 3 }, (_, i) =>
      makeEvent("tenancy.member.invited", new Date(Date.UTC(2026, 6, 15, 12, 0, i)), {
        seq: i + 1,
      }),
    );
    await writeOutboxEvents(sql, events);

    const delivered: number[] = [];
    const subscription: EventSubscription = {
      consumer: "audit",
      event: "tenancy.member.invited",
      handler: async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        delivered.push((event.payload as { seq: number }).seq);
      },
    };

    const store = new PostgresOutboxRelayStore(sql);
    const relay = new OutboxRelay({ store, subscriptions: [subscription], pollIntervalMs: 1000 });

    const inFlight = relay.pollOnce();
    await relay.drain();
    await inFlight;

    expect(delivered).toEqual([1, 2, 3]);
    const checkpoint = await store.getCheckpoint("audit");
    expect(checkpoint?.id).toBe(events[2]?.id);
  });
});
