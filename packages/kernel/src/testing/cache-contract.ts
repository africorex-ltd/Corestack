/**
 * The `Cache` port's contract suite (E04-T01). Covers only what the `Cache`
 * interface itself guarantees — get/set/delete round-tripping and TTL
 * expiry — not adapter-specific extras like a bounded-size eviction policy
 * (that's `InMemoryLruCache`'s own capacity-management detail, exercised in
 * kernel's own unit tests, not a cross-adapter contract).
 *
 * Every real implementation needs deterministic time to make TTL expiry
 * assertable without a real wall-clock wait, so the suite drives time itself
 * via a `FixedClock` it constructs and hands to the factory.
 */
import { FixedClock } from "../clock.js";
import type { Cache } from "../cache.js";
import type { SuiteHarness } from "./harness.js";

export interface CacheContractFactory {
  (clock: FixedClock): Cache | Promise<Cache>;
}

export function defineCacheContractSuite(
  harness: SuiteHarness,
  factory: CacheContractFactory,
): void {
  const { describe, it, expect } = harness;

  describe("Cache contract", () => {
    it("set/get round-trips a value", async () => {
      const cache = await factory(new FixedClock(new Date("2026-07-29T00:00:00Z")));
      await cache.set("k", { hello: true }, 60_000);
      expect(await cache.get("k")).toEqual({ hello: true });
    });

    it("get on a key that was never set returns undefined", async () => {
      const cache = await factory(new FixedClock(new Date("2026-07-29T00:00:00Z")));
      expect(await cache.get("never-set")).toBeUndefined();
    });

    it("honors TTL: readable until expiry, gone the instant it elapses", async () => {
      const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));
      const cache = await factory(clock);
      await cache.set("k", { hello: true }, 1000);

      expect(await cache.get("k")).toEqual({ hello: true });
      clock.advance(999);
      expect(await cache.get("k")).toEqual({ hello: true });
      clock.advance(1);
      expect(await cache.get("k")).toBeUndefined();
    });

    it("delete removes an entry before its TTL would otherwise expire it", async () => {
      const cache = await factory(new FixedClock(new Date("2026-07-29T00:00:00Z")));
      await cache.set("k", 1, 60_000);
      await cache.delete("k");
      expect(await cache.get("k")).toBeUndefined();
    });

    it("delete on a key that was never set is a no-op, not an error", async () => {
      const cache = await factory(new FixedClock(new Date("2026-07-29T00:00:00Z")));
      await expect(cache.delete("never-set")).resolves.toBeUndefined();
    });

    it("re-setting a key replaces both its value and its TTL clock", async () => {
      const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));
      const cache = await factory(clock);
      await cache.set("k", "first", 1000);
      clock.advance(500);
      await cache.set("k", "second", 1000); // TTL restarts from here
      clock.advance(999);
      expect(await cache.get("k")).toBe("second");
    });
  });
}
