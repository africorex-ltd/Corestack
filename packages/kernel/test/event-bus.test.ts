import { describe, expect, it } from "vitest";

import {
  createContext,
  createEvent,
  FixedClock,
  InMemoryEventBus,
  SequentialIdGenerator,
  type DomainEvent,
} from "../src/index.js";

function makeEvent(name: string, version = 1): DomainEvent {
  return createEvent(
    { name, version, payload: {} },
    createContext(
      { actor: { type: "system", id: null }, correlationId: "corr" },
      new SequentialIdGenerator(),
    ),
    {
      clock: new FixedClock(new Date("2026-07-28T00:00:00Z")),
      ids: new SequentialIdGenerator("evt-"),
    },
  );
}

describe("InMemoryEventBus", () => {
  it("delivers to matching subscribers sequentially in subscription order", async () => {
    const bus = new InMemoryEventBus();
    const calls: string[] = [];
    bus.subscribe({ consumer: "first", event: "a.b", handler: () => void calls.push("first") });
    bus.subscribe({ consumer: "second", event: "a.b", handler: () => void calls.push("second") });
    bus.subscribe({ consumer: "other", event: "x.y", handler: () => void calls.push("other") });

    await bus.publish([makeEvent("a.b")]);
    expect(calls).toEqual(["first", "second"]);
  });

  it("wildcard subscribers receive every event", async () => {
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    bus.subscribe({ consumer: "audit", event: "*", handler: (e) => void seen.push(e.name) });

    await bus.publish([makeEvent("a.b"), makeEvent("c.d")]);
    expect(seen).toEqual(["a.b", "c.d"]);
  });

  it("version filter delivers only declared versions", async () => {
    const bus = new InMemoryEventBus();
    const seen: number[] = [];
    bus.subscribe({
      consumer: "v1only",
      event: "a.b",
      versions: [1],
      handler: (e) => void seen.push(e.version),
    });

    await bus.publish([makeEvent("a.b", 1), makeEvent("a.b", 2)]);
    expect(seen).toEqual([1]);
  });

  it("attempts every handler even when one throws, then aggregates failures", async () => {
    const bus = new InMemoryEventBus();
    const calls: string[] = [];
    bus.subscribe({
      consumer: "boom",
      event: "a.b",
      handler: () => {
        calls.push("boom");
        throw new Error("boom");
      },
    });
    bus.subscribe({ consumer: "after", event: "a.b", handler: () => void calls.push("after") });

    await expect(bus.publish([makeEvent("a.b")])).rejects.toBeInstanceOf(AggregateError);
    expect(calls).toEqual(["boom", "after"]);
  });

  it("unsubscribe stops delivery", async () => {
    const bus = new InMemoryEventBus();
    const calls: string[] = [];
    const unsubscribe = bus.subscribe({
      consumer: "temp",
      event: "a.b",
      handler: () => void calls.push("temp"),
    });
    unsubscribe();

    await bus.publish([makeEvent("a.b")]);
    expect(calls).toEqual([]);
  });
});
