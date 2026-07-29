/**
 * Benchmark: `PostgresIdempotencyStore.begin` (E03-T43; E04 contract-suite
 * performance baselines). Measures one `begin()` call on a fresh
 * `(organizationId, scope, key)` — the `started` path — against real
 * Postgres. No threshold assertions — see
 * docs/quality/performance/contract-suite-adapter-benchmark-methodology.md.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { FixedClock } from "@corestack/kernel";
import type { Sql } from "postgres";

import { ensureIdempotencyKeysSchema } from "../src/infrastructure/postgres-idempotency-store-schema.js";
import { PostgresIdempotencyStore } from "../src/infrastructure/postgres-idempotency-store.js";
import { createTestDatabase, type TestDatabase } from "../test-support/test-database.js";
import { measure, writeBaseline, PERFORMANCE_BASELINE_DIR } from "./harness.js";

const ORG = "11111111-1111-1111-1111-111111111111";

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
  await ensureIdempotencyKeysSchema(sql);
  counter = 0;
});

describe("bench: PostgresIdempotencyStore.begin", () => {
  it("begins a fresh (org, scope, key) each call", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00.000Z"));
    const store = new PostgresIdempotencyStore(sql, clock);

    const stats = await measure(
      "idempotency-store-begin-fresh-key",
      async () => {
        counter += 1;
        await store.begin(ORG, "orders", `bench-key-${counter}`, "hash", 60_000);
      },
      { iterations: 50, warmup: 5 },
    );
    writeBaseline(stats, PERFORMANCE_BASELINE_DIR);
  }, 120_000);
});
