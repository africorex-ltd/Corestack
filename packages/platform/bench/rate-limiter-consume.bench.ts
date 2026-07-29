/**
 * Benchmark: `PostgresRateLimiter.consume` (E03-T41; E04 contract-suite
 * performance baselines). Measures one `consume()` call — the atomic
 * UPSERT described in `docs/rate-limiter.md` — against real Postgres.
 * No threshold assertions — see
 * docs/quality/performance/contract-suite-adapter-benchmark-methodology.md.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { FixedClock } from "@corestack/kernel";
import type { Sql } from "postgres";

import { ensureRateLimitsSchema } from "../src/infrastructure/postgres-rate-limiter-schema.js";
import { PostgresRateLimiter } from "../src/infrastructure/postgres-rate-limiter.js";
import { createTestDatabase, type TestDatabase } from "../test-support/test-database.js";
import { measure, writeBaseline, PERFORMANCE_BASELINE_DIR } from "./harness.js";

let db: TestDatabase;
let sql: Sql;
let counter = 0;

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
  counter = 0;
});

describe("bench: PostgresRateLimiter.consume", () => {
  it("consumes one unit against a fresh bucket each call", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00.000Z"));
    const limiter = new PostgresRateLimiter(sql, clock);

    const stats = await measure(
      "rate-limiter-consume-fresh-bucket",
      async () => {
        counter += 1;
        await limiter.consume(`bench-bucket-${counter}`, { limit: 10, windowMs: 60_000 });
      },
      { iterations: 50, warmup: 5 },
    );
    writeBaseline(stats, PERFORMANCE_BASELINE_DIR);
  }, 120_000);
});
