/**
 * The `RateLimiter` port's contract suite (E04-T01). Covers the fixed-window
 * semantics normative to every conforming adapter (Architecture §17/§25):
 * allow-up-to-the-limit-then-deny with a positive `retryAfterMs`,
 * epoch-aligned window reset, multi-unit `cost` accounting, and bucket
 * independence. Concurrency-under-a-shared-store races (only meaningful for
 * adapters with real shared storage, e.g. Postgres) stay adapter-specific —
 * see `rate-limiter.postgres.test.ts`.
 *
 * Window semantics are inherently time-based, so the suite drives time
 * itself via a `FixedClock` it constructs and hands to the factory, exactly
 * as kernel's own `InMemoryRateLimiter` and platform's `PostgresRateLimiter`
 * already accept.
 */
import { FixedClock } from "../clock.js";
import type { RateLimiter, RateLimitPolicy } from "../rate-limiter.js";
import type { SuiteHarness } from "./harness.js";

export interface RateLimiterContractFactory {
  (clock: FixedClock): RateLimiter | Promise<RateLimiter>;
}

export function defineRateLimiterContractSuite(
  harness: SuiteHarness,
  factory: RateLimiterContractFactory,
): void {
  const { describe, it, expect } = harness;
  const policy: RateLimitPolicy = { limit: 3, windowMs: 60_000 };

  describe("RateLimiter contract", () => {
    it("allows up to the limit then denies with retryAfter", async () => {
      const clock = new FixedClock(new Date("2026-07-28T00:00:00.000Z"));
      const limiter = await factory(clock);

      expect((await limiter.consume("b", policy)).allowed).toBe(true);
      expect((await limiter.consume("b", policy)).allowed).toBe(true);
      const third = await limiter.consume("b", policy);
      expect(third).toEqual({ allowed: true, limit: 3, remaining: 0, retryAfterMs: null });

      const denied = await limiter.consume("b", policy);
      expect(denied.allowed).toBe(false);
      expect(denied.remaining).toBe(0);
      expect(denied.retryAfterMs).toBeGreaterThan(0);
      expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
    });

    it("windows reset on epoch-aligned boundaries", async () => {
      const clock = new FixedClock(new Date("2026-07-28T00:00:59.000Z"));
      const limiter = await factory(clock);
      await limiter.consume("b", policy, 3);
      expect((await limiter.consume("b", policy)).allowed).toBe(false);

      clock.advance(1000); // crosses the minute boundary
      expect((await limiter.consume("b", policy)).allowed).toBe(true);
    });

    it("cost consumes multiple units and never over-admits", async () => {
      const clock = new FixedClock(new Date("2026-07-28T00:00:00.000Z"));
      const limiter = await factory(clock);
      expect((await limiter.consume("b", policy, 2)).remaining).toBe(1);
      expect((await limiter.consume("b", policy, 2)).allowed).toBe(false);
      expect((await limiter.consume("b", policy, 1)).allowed).toBe(true);
    });

    it("buckets are independent", async () => {
      const clock = new FixedClock(new Date("2026-07-28T00:00:00.000Z"));
      const limiter = await factory(clock);
      await limiter.consume("a", policy, 3);
      expect((await limiter.consume("b", policy)).allowed).toBe(true);
    });

    it("a single request whose cost exceeds the limit is denied outright, without partial admission", async () => {
      const clock = new FixedClock(new Date("2026-07-28T00:00:00.000Z"));
      const limiter = await factory(clock);
      const decision = await limiter.consume("b", { limit: 10, windowMs: 60_000 }, 9);
      expect(decision).toEqual({ allowed: true, limit: 10, remaining: 1, retryAfterMs: null });

      const overLimit = await limiter.consume("fresh-bucket", { limit: 5, windowMs: 60_000 }, 10);
      expect(overLimit.allowed).toBe(false);
      expect(overLimit.remaining).toBe(5);
    });
  });
}
