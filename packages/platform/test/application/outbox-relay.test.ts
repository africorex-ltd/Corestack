import { describe, expect, it } from "vitest";
import {
  createContext,
  createEvent,
  FixedClock,
  SequentialIdGenerator,
  type DomainEvent,
  type EventSubscription,
} from "@corestack/kernel";

import { OutboxRelay } from "../../src/application/outbox-relay.js";
import { InMemoryOutboxRelayStore } from "../../src/testing/in-memory-outbox-relay-store.js";

const ids = new SequentialIdGenerator("evt");

function makeEvent(
  name: string,
  occurredAtMs: number,
  version = 1,
  payload: unknown = {},
): DomainEvent {
  const clock = new FixedClock(new Date(occurredAtMs));
  const context = createContext({ actor: { type: "system", id: null } }, ids);
  return createEvent({ name, version, payload }, context, { clock, ids });
}

describe("OutboxRelay orchestration (in-memory store)", () => {
  it("delivers events to a consumer in order and advances its checkpoint", async () => {
    const store = new InMemoryOutboxRelayStore();
    const e1 = makeEvent("tenancy.member.invited", 1000);
    const e2 = makeEvent("tenancy.member.invited", 2000);
    store.seed(e1, e2);

    const delivered: string[] = [];
    const subscription: EventSubscription = {
      consumer: "audit",
      event: "tenancy.member.invited",
      handler: (event) => {
        delivered.push(event.id);
      },
    };

    const relay = new OutboxRelay({ store, subscriptions: [subscription], pollIntervalMs: 1000 });
    await relay.pollOnce();

    expect(delivered).toEqual([e1.id, e2.id]);
    expect(await store.getCheckpoint("audit")).toEqual({ occurredAt: e2.occurredAt, id: e2.id });
  });

  it("stops advancing past a failed event; the next round redelivers from there, not from the start", async () => {
    const store = new InMemoryOutboxRelayStore();
    const events = [1000, 2000, 3000, 4000, 5000].map((ms, i) =>
      makeEvent("tenancy.member.invited", ms, 1, { seq: i + 1 }),
    );
    store.seed(...events);

    const delivered: number[] = [];
    let round = 0;
    const subscription: EventSubscription = {
      consumer: "audit",
      event: "tenancy.member.invited",
      handler: (event) => {
        const seq = (event.payload as { seq: number }).seq;
        if (seq === 3 && round === 0) {
          throw new Error("simulated handler failure on event 3");
        }
        delivered.push(seq);
      },
    };

    const relay = new OutboxRelay({ store, subscriptions: [subscription], pollIntervalMs: 1000 });
    await relay.pollOnce();
    expect(delivered).toEqual([1, 2]);
    expect(await store.getCheckpoint("audit")).toEqual({
      occurredAt: events[1]?.occurredAt,
      id: events[1]?.id,
    });

    round = 1;
    await relay.pollOnce();
    expect(delivered).toEqual([1, 2, 3, 4, 5]);
  });

  it("isolates two consumers on the same stream: one permanently failing never stalls the other", async () => {
    const store = new InMemoryOutboxRelayStore();
    const e1 = makeEvent("tenancy.member.invited", 1000);
    const e2 = makeEvent("tenancy.member.invited", 2000);
    store.seed(e1, e2);

    const goodDelivered: string[] = [];
    const subscriptions: EventSubscription[] = [
      {
        consumer: "always-fails",
        event: "tenancy.member.invited",
        handler: () => {
          throw new Error("permanently broken consumer");
        },
      },
      {
        consumer: "good",
        event: "tenancy.member.invited",
        handler: (event) => {
          goodDelivered.push(event.id);
        },
      },
    ];

    const relay = new OutboxRelay({ store, subscriptions, pollIntervalMs: 1000 });
    await relay.pollOnce();
    await relay.pollOnce();
    await relay.pollOnce();

    expect(goodDelivered).toEqual([e1.id, e2.id]);
    expect(await store.getCheckpoint("always-fails")).toBeNull();
    expect(await store.getCheckpoint("good")).toEqual({ occurredAt: e2.occurredAt, id: e2.id });
  });

  it("skips non-matching events (name and version) without invoking the handler, but still advances past them", async () => {
    const matching = makeEvent("tenancy.member.invited", 2000, 1);
    const wrongName = makeEvent("billing.invoice.issued", 1000, 1);
    const wrongVersion = makeEvent("tenancy.member.invited", 3000, 2);
    const store = new InMemoryOutboxRelayStore();
    store.seed(wrongName, matching, wrongVersion);

    const delivered: string[] = [];
    const subscription: EventSubscription = {
      consumer: "v1-only",
      event: "tenancy.member.invited",
      versions: [1],
      handler: (event) => {
        delivered.push(event.id);
      },
    };

    const relay = new OutboxRelay({ store, subscriptions: [subscription], pollIntervalMs: 1000 });
    await relay.pollOnce();

    expect(delivered).toEqual([matching.id]);
    // Checkpoint advances past the trailing non-matching event too, not
    // just the last matching one — otherwise it would be refetched forever.
    expect(await store.getCheckpoint("v1-only")).toEqual({
      occurredAt: wrongVersion.occurredAt,
      id: wrongVersion.id,
    });
  });

  it("a wildcard subscription receives every event regardless of name", async () => {
    const store = new InMemoryOutboxRelayStore();
    const a = makeEvent("tenancy.member.invited", 1000);
    const b = makeEvent("billing.invoice.issued", 2000);
    store.seed(a, b);

    const delivered: string[] = [];
    const subscription: EventSubscription = {
      consumer: "audit-all",
      event: "*",
      handler: (event) => {
        delivered.push(event.name);
      },
    };

    const relay = new OutboxRelay({ store, subscriptions: [subscription], pollIntervalMs: 1000 });
    await relay.pollOnce();

    expect(delivered).toEqual(["tenancy.member.invited", "billing.invoice.issued"]);
  });

  it("loops internally within one pollOnce() until caught up, even with a small batch size", async () => {
    const store = new InMemoryOutboxRelayStore();
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent("tenancy.member.invited", (i + 1) * 1000),
    );
    store.seed(...events);

    const delivered: string[] = [];
    const subscription: EventSubscription = {
      consumer: "audit",
      event: "tenancy.member.invited",
      handler: (event) => {
        delivered.push(event.id);
      },
    };

    const relay = new OutboxRelay({
      store,
      subscriptions: [subscription],
      batchSize: 2,
      pollIntervalMs: 1000,
    });
    await relay.pollOnce();

    expect(delivered).toEqual(events.map((e) => e.id));
  });

  it("reports lag as 0 once a consumer has caught up, and non-zero lag right after processing", async () => {
    const store = new InMemoryOutboxRelayStore();
    const event = makeEvent("tenancy.member.invited", Date.now() - 5000);
    store.seed(event);

    const lags: number[] = [];
    const subscription: EventSubscription = {
      consumer: "audit",
      event: "tenancy.member.invited",
      handler: () => {},
    };

    const relay = new OutboxRelay({
      store,
      subscriptions: [subscription],
      pollIntervalMs: 1000,
      onLag: (_consumer, lagMs) => lags.push(lagMs),
    });
    await relay.pollOnce();
    expect(lags[0]).toBeGreaterThanOrEqual(4000);

    await relay.pollOnce();
    expect(lags[1]).toBe(0);
  });

  it("stopIntake/drain resolve cleanly with no active round, and drain awaits an in-flight round", async () => {
    const store = new InMemoryOutboxRelayStore();
    const relay = new OutboxRelay({ store, subscriptions: [], pollIntervalMs: 1000 });

    await expect(relay.stopIntake()).resolves.toBeUndefined();
    await expect(relay.drain()).resolves.toBeUndefined();

    const inFlight = relay.pollOnce();
    await expect(relay.drain()).resolves.toBeUndefined();
    await inFlight;
  });
});
