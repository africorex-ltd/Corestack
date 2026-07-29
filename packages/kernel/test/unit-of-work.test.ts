import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createContext,
  createEvent,
  FixedClock,
  InMemoryEventBus,
  InMemoryProcessedEventStore,
  InMemoryUnitOfWork,
  SequentialIdGenerator,
  type DomainEvent,
} from "../src/index.js";
import {
  defineProcessedEventStoreContractSuite,
  defineUnitOfWorkContractSuite,
  type SuiteHarness,
} from "../src/testing/index.js";

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

describe("InMemoryProcessedEventStore via the shared ProcessedEventStore contract suite", () => {
  defineProcessedEventStoreContractSuite(harness, () => new InMemoryProcessedEventStore());
});
