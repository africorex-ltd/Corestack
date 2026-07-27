import { describe, expect, it } from "vitest";

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

describe("InMemoryUnitOfWork", () => {
  it("dispatches staged events only after work resolves", async () => {
    const bus = new InMemoryEventBus();
    const delivered: string[] = [];
    bus.subscribe({ consumer: "c", event: "*", handler: (e) => void delivered.push(e.id) });
    const uow = new InMemoryUnitOfWork(bus);

    const result = await uow.run(async (tx) => {
      tx.publish(makeEvent("a-"));
      expect(delivered).toEqual([]); // nothing dispatched mid-transaction
      tx.publish(makeEvent("b-"));
      return "done";
    });

    expect(result).toBe("done");
    expect(delivered).toEqual(["a-1", "b-1"]);
  });

  it("discards staged events when work throws", async () => {
    const bus = new InMemoryEventBus();
    const delivered: string[] = [];
    bus.subscribe({ consumer: "c", event: "*", handler: (e) => void delivered.push(e.id) });
    const uow = new InMemoryUnitOfWork(bus);

    await expect(
      uow.run(async (tx) => {
        tx.publish(makeEvent());
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(delivered).toEqual([]);
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
