import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createContext,
  createEvent,
  FixedClock,
  idempotentHandler,
  InMemoryEventBus,
  InMemoryProcessedEventStore,
  InMemoryUnitOfWork,
  SequentialIdGenerator,
  type DomainEvent,
} from "../src/index.js";
import { defineUnitOfWorkContractSuite, type SuiteHarness } from "../src/testing/index.js";

const harness: SuiteHarness = { describe, it, expect, beforeEach, afterEach };

function makeEvent(idPrefix = "evt-"): DomainEvent {
  return createEvent(
    { name: "fixture.thing.happened", version: 1, payload: {} },
    createContext({ actor: { type: "system", id: null } }, new SequentialIdGenerator("ctx-")),
    {
      clock: new FixedClock(new Date("2026-07-28T00:00:00Z")),
      ids: new SequentialIdGenerator(idPrefix),
    },
  );
}

describe("InMemoryUnitOfWork via the shared UnitOfWork contract suite", () => {
  defineUnitOfWorkContractSuite(
    harness,
    () => {
      const bus = new InMemoryEventBus();
      let delivered: DomainEvent[] = [];
      bus.subscribe({ consumer: "drain", event: "*", handler: (e) => void delivered.push(e) });
      return {
        uow: new InMemoryUnitOfWork(bus),
        drainDispatched: async () => {
          const batch = delivered;
          delivered = [];
          return batch;
        },
      };
    },
    (idSuffix) => makeEvent(idSuffix),
  );
});

describe("InMemoryUnitOfWork (adapter-specific)", () => {
  it("nothing is dispatched while work is still running — only after run() resolves", async () => {
    const bus = new InMemoryEventBus();
    const delivered: string[] = [];
    bus.subscribe({ consumer: "c", event: "*", handler: (e) => void delivered.push(e.id) });
    const uow = new InMemoryUnitOfWork(bus);

    await uow.run(async (tx) => {
      tx.publish(makeEvent("a-"));
      expect(delivered).toEqual([]); // nothing dispatched mid-transaction
      tx.publish(makeEvent("b-"));
      return "done";
    });

    expect(delivered).toEqual(["a-1", "b-1"]);
  });

  it("AUD-03 regression: consumer failures never fail the producer (ADR-0009)", async () => {
    // Before the fix, a throwing subscriber rejected run() AFTER the work
    // had logically committed — diverging from production semantics where
    // the outbox relay isolates consumer failures from producers.
    const bus = new InMemoryEventBus();
    bus.subscribe({
      consumer: "broken",
      event: "*",
      handler: () => {
        throw new Error("consumer exploded");
      },
    });
    const observed: unknown[] = [];
    const uow = new InMemoryUnitOfWork(bus, {
      onDispatchError: (error, events) => observed.push([error, events.length]),
    });

    const result = await uow.run(async (tx) => {
      tx.publish(makeEvent());
      return "committed";
    });

    expect(result).toBe("committed"); // the use case succeeded
    expect(observed).toHaveLength(1); // the failure was observed, not thrown
    expect((observed[0] as [unknown, number])[0]).toBeInstanceOf(AggregateError);
  });
});

describe("idempotentHandler", () => {
  it("invokes the handler exactly once per (consumer, event id)", async () => {
    const store = new InMemoryProcessedEventStore();
    let calls = 0;
    const handler = idempotentHandler("audit", store, () => {
      calls += 1;
    });

    const event = makeEvent();
    await handler(event);
    await handler(event); // redelivery
    expect(calls).toBe(1);
  });

  it("AUD-02 regression: a failed event stays unmarked and is retried on redelivery", async () => {
    // Before the fix, the event was marked BEFORE handling, so a handler
    // failure permanently lost the event (at-most-once). At-least-once
    // requires the failure path to leave the event retryable.
    const store = new InMemoryProcessedEventStore();
    let attempts = 0;
    const handler = idempotentHandler("audit", store, () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient failure");
    });

    const event = makeEvent();
    await expect(handler(event)).rejects.toThrow("transient failure");
    expect(await store.hasProcessed("audit", event.id)).toBe(false);

    await handler(event); // redelivery succeeds
    expect(attempts).toBe(2);
    expect(await store.hasProcessed("audit", event.id)).toBe(true);

    await handler(event); // further redelivery is a no-op
    expect(attempts).toBe(2);
  });

  it("dedupes per consumer, not globally", async () => {
    const store = new InMemoryProcessedEventStore();
    const calls: string[] = [];
    const auditHandler = idempotentHandler("audit", store, () => void calls.push("audit"));
    const webhookHandler = idempotentHandler("webhooks", store, () => void calls.push("webhooks"));

    const event = makeEvent();
    await auditHandler(event);
    await webhookHandler(event);
    expect(calls).toEqual(["audit", "webhooks"]);
  });
});
