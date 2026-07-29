/**
 * The `EventBus` port's contract suite (E04, following E04-T01's
 * framework). Covers exactly what `event-bus.ts`'s doc comment makes
 * normative: sequential in-subscription-order delivery, wildcard/version
 * matching, every-handler-attempted with aggregated failures, unsubscribe,
 * and that published events reach handlers unchanged (context
 * propagation).
 *
 * `EventBus` has no time-based contract, so the factory takes no clock —
 * unlike `Cache`/`RateLimiter`, ordering here is about call sequence, not
 * wall-clock time.
 *
 * Only `InMemoryEventBus` exists; there is no Postgres `EventBus`
 * implementation, and none is planned — the transactional outbox relay is
 * a deliberately separate, asynchronous reliability mechanism (ADR-0009),
 * not a second `EventBus`. See
 * `docs/testing/adapter-certification-matrix.md` for why that pairing is
 * "not applicable" rather than "pending."
 */
import type { DomainEvent } from "../event.js";
import type { EventBus } from "../event-bus.js";
import type { SuiteHarness } from "./harness.js";

export interface EventBusContractFactory {
  (): EventBus | Promise<EventBus>;
}

export function defineEventBusContractSuite(
  harness: SuiteHarness,
  factory: EventBusContractFactory,
  makeEvent: (name: string, version?: number) => DomainEvent,
): void {
  const { describe, it, expect } = harness;

  describe("EventBus contract", () => {
    it("delivers to matching subscribers sequentially, in subscription order", async () => {
      const bus = await factory();
      const calls: string[] = [];
      bus.subscribe({ consumer: "first", event: "a.b", handler: () => void calls.push("first") });
      bus.subscribe({ consumer: "second", event: "a.b", handler: () => void calls.push("second") });
      bus.subscribe({ consumer: "other", event: "x.y", handler: () => void calls.push("other") });

      await bus.publish([makeEvent("a.b")]);
      expect(calls).toEqual(["first", "second"]);
    });

    it("a batch is delivered event by event, in batch order", async () => {
      const bus = await factory();
      const seen: string[] = [];
      bus.subscribe({ consumer: "sub", event: "*", handler: (e) => void seen.push(e.name) });

      await bus.publish([makeEvent("a.b"), makeEvent("c.d"), makeEvent("e.f")]);
      expect(seen).toEqual(["a.b", "c.d", "e.f"]);
    });

    it("wildcard subscribers receive every event", async () => {
      const bus = await factory();
      const seen: string[] = [];
      bus.subscribe({ consumer: "audit", event: "*", handler: (e) => void seen.push(e.name) });

      await bus.publish([makeEvent("a.b"), makeEvent("c.d")]);
      expect(seen).toEqual(["a.b", "c.d"]);
    });

    it("a version filter delivers only declared contract versions; undeclared accepts all", async () => {
      const bus = await factory();
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

    it("attempts every matching handler even when an earlier one throws, then aggregates failures", async () => {
      const bus = await factory();
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

    it("unsubscribe stops further delivery to that subscription only", async () => {
      const bus = await factory();
      const calls: string[] = [];
      const unsubscribeTemp = bus.subscribe({
        consumer: "temp",
        event: "a.b",
        handler: () => void calls.push("temp"),
      });
      bus.subscribe({ consumer: "stays", event: "a.b", handler: () => void calls.push("stays") });
      unsubscribeTemp();

      await bus.publish([makeEvent("a.b")]);
      expect(calls).toEqual(["stays"]);
    });

    it("a published event reaches its handler with every envelope field unchanged (context propagation)", async () => {
      const bus = await factory();
      let received: DomainEvent | undefined;
      bus.subscribe({ consumer: "observer", event: "a.b", handler: (e) => void (received = e) });

      const event = makeEvent("a.b");
      await bus.publish([event]);
      expect(received).toEqual(event);
    });

    it("publish() has no built-in deduplication — republishing the same event redelivers it (callers needing dedupe use ProcessedEventStore/idempotentHandler)", async () => {
      const bus = await factory();
      const seen: string[] = [];
      const event = makeEvent("a.b");
      bus.subscribe({ consumer: "sub", event: "a.b", handler: (e) => void seen.push(e.id) });

      await bus.publish([event]);
      await bus.publish([event]);
      expect(seen).toEqual([event.id, event.id]);
    });
  });
}
