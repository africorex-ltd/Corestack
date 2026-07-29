/**
 * The `IdempotencyStore` port's contract suite (E04, following E04-T01's
 * framework). Covers the full begin/complete lifecycle `idempotency-store.ts`'s
 * doc comment makes normative: fresh-start then replay, mid-flight
 * `inProgress`, `conflict` on a reused key with a different body, scope
 * independence, organization isolation (ADR-0020's regression, relocated
 * here rather than duplicated), expiry reclaiming both lock kinds, and
 * `complete()`'s no-op guarantees against a stale or never-started attempt.
 *
 * Every case here held for the in-memory adapter *before* this suite
 * existed and is not a new discovery — this is a relocation/consolidation
 * of `packages/kernel/test/ports.test.ts`'s existing `IdempotencyStore`
 * block, not new coverage.
 *
 * Genuine concurrent-request races (two connections racing `begin()` on
 * the identical key) stay a Postgres-specific adjunct — the in-memory
 * `Map`-backed adapter can't race meaningfully in a single-threaded
 * runtime, same call as `RateLimiter`'s 20-caller test.
 *
 * Both adapters accept a `Clock` (constructor option), so — like
 * `Cache`/`RateLimiter` — the factory takes a `FixedClock` the suite
 * drives itself, making expiry assertions deterministic.
 */
import { FixedClock } from "../clock.js";
import type { IdempotencyStore } from "../idempotency-store.js";
import type { SuiteHarness } from "./harness.js";

export interface IdempotencyStoreContractFactory {
  (clock: FixedClock): IdempotencyStore | Promise<IdempotencyStore>;
}

export function defineIdempotencyStoreContractSuite(
  harness: SuiteHarness,
  factory: IdempotencyStoreContractFactory,
): void {
  const { describe, it, expect } = harness;
  const ORG_A = "11111111-1111-1111-1111-111111111111";
  const ORG_B = "22222222-2222-2222-2222-222222222222";

  describe("IdempotencyStore contract", () => {
    it("a fresh (org, scope, key) starts, then completes and replays with the same body", async () => {
      const store = await factory(new FixedClock(new Date("2026-07-29T00:00:00Z")));
      expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
        outcome: "started",
      });

      await store.complete(ORG_A, "orders", "k1", "hash-a", { orderId: "o1" }, 60_000);
      expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
        outcome: "replay",
        response: { orderId: "o1" },
      });
    });

    it("a second caller mid-flight sees inProgress, not started or replay", async () => {
      const store = await factory(new FixedClock(new Date("2026-07-29T00:00:00Z")));
      await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000);
      expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
        outcome: "inProgress",
      });
    });

    it("the same key with a different body is a conflict, in-progress or completed", async () => {
      const store = await factory(new FixedClock(new Date("2026-07-29T00:00:00Z")));
      await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000);
      expect(await store.begin(ORG_A, "orders", "k1", "hash-b", 60_000)).toEqual({
        outcome: "conflict",
      });

      await store.complete(ORG_A, "orders", "k1", "hash-a", { orderId: "o1" }, 60_000);
      expect(await store.begin(ORG_A, "orders", "k1", "hash-b", 60_000)).toEqual({
        outcome: "conflict",
      });
    });

    it("scopes are independent — the same key in a different scope starts fresh", async () => {
      const store = await factory(new FixedClock(new Date("2026-07-29T00:00:00Z")));
      await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000);
      expect(await store.begin(ORG_A, "refunds", "k1", "hash-a", 60_000)).toEqual({
        outcome: "started",
      });
    });

    it("SECURITY (ADR-0020): two organizations presenting the identical (scope, key, requestHash) never share a lock or a replayed response", async () => {
      const store = await factory(new FixedClock(new Date("2026-07-29T00:00:00Z")));

      expect(
        await store.begin(ORG_A, "orders:create", "same-client-key", "same-body-hash", 60_000),
      ).toEqual({ outcome: "started" });
      await store.complete(
        ORG_A,
        "orders:create",
        "same-client-key",
        "same-body-hash",
        { orderId: "org-a-secret-order" },
        60_000,
      );

      const orgBResult = await store.begin(
        ORG_B,
        "orders:create",
        "same-client-key",
        "same-body-hash",
        60_000,
      );
      expect(orgBResult).toEqual({ outcome: "started" });

      expect(
        await store.begin(ORG_A, "orders:create", "same-client-key", "same-body-hash", 60_000),
      ).toEqual({ outcome: "replay", response: { orderId: "org-a-secret-order" } });
    });

    it("null organizationId (platform-scoped) is independent from any real organization", async () => {
      const store = await factory(new FixedClock(new Date("2026-07-29T00:00:00Z")));
      await store.begin(null, "orders", "k1", "hash-a", 60_000);
      expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
        outcome: "started",
      });
    });

    it("an expired in_progress lock is reclaimable — recovers a crashed caller's key", async () => {
      const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));
      const store = await factory(clock);
      await store.begin(ORG_A, "orders", "k1", "hash-a", 1000); // caller "crashes", never completes

      clock.advance(999);
      expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 1000)).toEqual({
        outcome: "inProgress",
      });
      clock.advance(1);
      expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 1000)).toEqual({
        outcome: "started",
      });
    });

    it("an expired completed entry is no longer replayable — starts fresh, not replay", async () => {
      const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));
      const store = await factory(clock);
      await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000);
      await store.complete(ORG_A, "orders", "k1", "hash-a", { orderId: "o1" }, 1000);

      clock.advance(1001);
      expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
        outcome: "started",
      });
    });

    it("complete() is a no-op once the lock has expired and been reclaimed by a newer attempt", async () => {
      const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));
      const store = await factory(clock);
      await store.begin(ORG_A, "orders", "k1", "hash-a", 1000); // attempt #1

      clock.advance(1001); // attempt #1's lock expires, unreclaimed
      await store.begin(ORG_A, "orders", "k1", "hash-b", 60_000); // attempt #2 reclaims with a new body

      // attempt #1's stale complete() must not clobber attempt #2's in-progress state
      await store.complete(ORG_A, "orders", "k1", "hash-a", { stale: true }, 60_000);
      expect(await store.begin(ORG_A, "orders", "k1", "hash-b", 60_000)).toEqual({
        outcome: "inProgress",
      });
    });

    it("complete() is a no-op if called before begin() ever ran", async () => {
      const store = await factory(new FixedClock(new Date("2026-07-29T00:00:00Z")));
      await store.complete(ORG_A, "orders", "k1", "hash-a", { orderId: "o1" }, 60_000);
      expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
        outcome: "started",
      });
    });
  });
}
