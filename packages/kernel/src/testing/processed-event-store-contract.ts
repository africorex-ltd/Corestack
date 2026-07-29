/**
 * The `ProcessedEventStore` port's contract suite (E04, following
 * E04-T01's framework). Covers what `processed-events.ts`'s doc comment
 * makes normative: `hasProcessed` reflects `markProcessed` exactly,
 * marking is idempotent (no error, no effect change on a repeat mark),
 * consumers are scoped independently, and — via `idempotentHandler` — a
 * handler runs exactly once per (consumer, event id) while a failed
 * attempt leaves the event unmarked and retryable (at-least-once).
 *
 * **Deliberately excluded, adapter-specific:**
 * - Genuine concurrent-write races (two connections marking the same
 *   pair simultaneously) — only meaningful against real shared storage;
 *   the in-memory `Set`-backed adapter can't race meaningfully in a
 *   single-threaded runtime. Postgres-specific adjunct, same call as
 *   `RateLimiter`'s 20-caller test.
 * - Same-transaction atomicity between a handler's own state change and
 *   the mark (`PostgresProcessedEventStore` bound to an open
 *   `TransactionSql`) — this is a caller-composition concern (the generic
 *   `idempotentHandler` wrapper can't provide it by itself; see that
 *   adapter's own doc comment), not a property of the port's two methods
 *   in isolation.
 * - "Cleanup safety" (requested in the founder directive): this port has
 *   no cleanup/prune method of its own — retention of old
 *   `platform.processed_events` rows is `maintainOutboxPartitions`'s
 *   concern (already tested there), not this port's contract.
 */
import type { DomainEvent } from "../event.js";
import { idempotentHandler } from "../processed-events.js";
import type { ProcessedEventStore } from "../processed-events.js";
import type { SuiteHarness } from "./harness.js";

/**
 * `idempotentHandler` and the store it wraps only ever read `event.id` —
 * every other `DomainEvent` field is irrelevant to this port's contract,
 * so this fixture fills them with fixed placeholders rather than pulling
 * in `createEvent`/`createContext`/an id generator just to build one.
 */
function fakeEvent(id: string): DomainEvent {
  return {
    id,
    name: "fixture.thing.happened",
    version: 1,
    occurredAt: new Date("2026-07-29T00:00:00Z"),
    organizationId: null,
    actor: { type: "system", id: null },
    correlationId: "corr-1",
    causationId: null,
    payload: {},
  };
}

// Real UUIDs, not readable literals like "evt-1": platform's Postgres
// adapter stores event_id in a `uuid` column, so a non-UUID string fails
// the cast the instant a real adapter is exercised — the same gotcha
// documented across this codebase's other Postgres integration tests.
const EVENT_1 = "11111111-1111-1111-1111-111111111111";
const EVENT_2 = "22222222-2222-2222-2222-222222222222";

export interface ProcessedEventStoreContractFactory {
  (): ProcessedEventStore | Promise<ProcessedEventStore>;
}

export function defineProcessedEventStoreContractSuite(
  harness: SuiteHarness,
  factory: ProcessedEventStoreContractFactory,
): void {
  const { describe, it, expect } = harness;

  describe("ProcessedEventStore contract", () => {
    it("hasProcessed is false before markProcessed and true after", async () => {
      const store = await factory();
      expect(await store.hasProcessed("audit", EVENT_1)).toBe(false);
      await store.markProcessed("audit", EVENT_1);
      expect(await store.hasProcessed("audit", EVENT_1)).toBe(true);
    });

    it("markProcessed is idempotent — marking the same (consumer, event id) twice does not error", async () => {
      const store = await factory();
      await store.markProcessed("audit", EVENT_1);
      await expect(store.markProcessed("audit", EVENT_1)).resolves.toBeUndefined();
      expect(await store.hasProcessed("audit", EVENT_1)).toBe(true);
    });

    it("scope isolation: two different consumers have independent processed state for the same event id", async () => {
      const store = await factory();
      await store.markProcessed("audit", EVENT_1);
      expect(await store.hasProcessed("audit", EVENT_1)).toBe(true);
      expect(await store.hasProcessed("billing", EVENT_1)).toBe(false);
    });

    it("scope isolation: the same consumer's marks for different event ids are independent", async () => {
      const store = await factory();
      await store.markProcessed("audit", EVENT_1);
      expect(await store.hasProcessed("audit", EVENT_1)).toBe(true);
      expect(await store.hasProcessed("audit", EVENT_2)).toBe(false);
    });

    it("via idempotentHandler: invokes the handler exactly once per (consumer, event id); redelivery is a no-op", async () => {
      const store = await factory();
      let calls = 0;
      const handler = idempotentHandler("audit", store, () => {
        calls += 1;
      });

      await handler(fakeEvent(EVENT_1));
      await handler(fakeEvent(EVENT_1));
      expect(calls).toBe(1);
    });

    it("via idempotentHandler: a failed attempt leaves the event unmarked and retryable (at-least-once)", async () => {
      // AUD-02: marking BEFORE handling (rather than after success) would
      // make a handler failure permanently lose the event — at-most-once,
      // not the at-least-once this port's doc requires.
      const store = await factory();
      let attempts = 0;
      const handler = idempotentHandler("audit", store, () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient failure");
      });

      const event = fakeEvent(EVENT_1);
      await expect(handler(event)).rejects.toThrow("transient failure");
      expect(await store.hasProcessed("audit", EVENT_1)).toBe(false);

      await handler(event); // redelivery succeeds
      expect(attempts).toBe(2);
      expect(await store.hasProcessed("audit", EVENT_1)).toBe(true);

      await handler(event); // further redelivery is a no-op
      expect(attempts).toBe(2);
    });
  });
}
