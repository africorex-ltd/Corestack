/**
 * Real-Postgres integration tests for E03-T41's `PostgresRateLimiter`
 * (kernel's `RateLimiter` port). First mirrors the exact behavioral
 * contract kernel's own `InMemoryRateLimiter` suite already proves
 * (`packages/kernel/test/ports.test.ts`) — allow-up-to-limit-then-deny
 * with a positive `retryAfterMs`, and epoch-aligned window reset — then
 * proves the Postgres-specific angle no in-memory store can: concurrent
 * callers racing the same bucket's remaining quota never jointly
 * over-consume it, and explicit window pruning.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "@corestack/kernel";
import type { Sql } from "postgres";

import { ensureRateLimitsSchema } from "../../src/infrastructure/postgres-rate-limiter-schema.js";
import {
  PostgresRateLimiter,
  pruneRateLimitWindows,
} from "../../src/infrastructure/postgres-rate-limiter.js";
import { createTestDatabase, type TestDatabase } from "../../test-support/test-database.js";

let db: TestDatabase;
let sql: Sql;

beforeAll(async () => {
  db = await createTestDatabase();
  sql = db.sql;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await sql.unsafe(`DROP SCHEMA IF EXISTS platform CASCADE`);
  await ensureRateLimitsSchema(sql);
});

describe("PostgresRateLimiter (E03-T41 integration)", () => {
  const policy = { limit: 3, windowMs: 60_000 };

  it("allows up to the limit then denies with retryAfter", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00.000Z"));
    const limiter = new PostgresRateLimiter(sql, clock);

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
    const clock = new FixedClock(new Date("2026-07-29T00:00:59.000Z"));
    const limiter = new PostgresRateLimiter(sql, clock);
    await limiter.consume("b", policy, 3);
    expect((await limiter.consume("b", policy)).allowed).toBe(false);

    clock.advance(1000); // crosses the minute boundary
    expect((await limiter.consume("b", policy)).allowed).toBe(true);
  });

  it("a single request whose cost exceeds the limit is denied without seeding an over-limit row", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00.000Z"));
    const limiter = new PostgresRateLimiter(sql, clock);

    // Regression case for the lexicographic-comparison bug found while
    // building this adapter: cost=9, limit=10 must compare numerically
    // (9 <= 10), not as strings ("9" > "10").
    const decision = await limiter.consume("b", { limit: 10, windowMs: 60_000 }, 9);
    expect(decision).toEqual({ allowed: true, limit: 10, remaining: 1, retryAfterMs: null });

    const overLimit = await limiter.consume("fresh-bucket", { limit: 5, windowMs: 60_000 }, 10);
    expect(overLimit.allowed).toBe(false);
    expect(overLimit.remaining).toBe(5);

    const rows = await sql`SELECT count FROM platform.rate_limits WHERE bucket = 'fresh-bucket'`;
    expect(rows).toHaveLength(0);
  });

  it("concurrent callers racing the same bucket never jointly over-consume it", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00.000Z"));
    const limiter = new PostgresRateLimiter(sql, clock);
    const concurrentPolicy = { limit: 10, windowMs: 60_000 };

    const decisions = await Promise.all(
      Array.from({ length: 20 }, () => limiter.consume("race-bucket", concurrentPolicy)),
    );

    const allowed = decisions.filter((d) => d.allowed).length;
    const denied = decisions.filter((d) => !d.allowed).length;
    expect(allowed).toBe(10);
    expect(denied).toBe(10);

    const rows = await sql<{ count: number }[]>`
      SELECT count FROM platform.rate_limits WHERE bucket = 'race-bucket'
    `;
    expect(rows[0]?.count).toBe(10);
  });
});

describe("pruneRateLimitWindows (E03-T41 integration)", () => {
  it("deletes only windows older than the given cutoff", async () => {
    await sql`
      INSERT INTO platform.rate_limits (bucket, window_start, count) VALUES
      ('old', '2026-07-01T00:00:00Z', 5),
      ('recent', '2026-07-28T00:00:00Z', 3)
    `;

    const deleted = await pruneRateLimitWindows(sql, new Date("2026-07-15T00:00:00Z"));
    expect(deleted).toBe(1);

    const remaining = await sql<{ bucket: string }[]>`SELECT bucket FROM platform.rate_limits`;
    expect(remaining.map((r) => r.bucket)).toEqual(["recent"]);
  });
});
