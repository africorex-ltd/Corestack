/**
 * Benchmark: partition maintenance (E03-T03). Measures the steady-state
 * cost of maintainOutboxPartitions's create-ahead path — the common case
 * once a deployment's partitions already exist and each periodic call
 * finds nothing new to create (a `pg_inherits` query plus idempotent
 * `CREATE TABLE IF NOT EXISTS` DDL). Retention-drop is not exercised here:
 * it is opt-in and its cost is dominated by however many partitions are
 * actually eligible to drop in a given deployment, which isn't a fixed
 * quantity to benchmark against. No threshold assertions — see
 * docs/quality/architecture-benchmarks/outbox-benchmark-methodology.md.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import type { Sql } from "postgres";

import { ensureOutboxSchema } from "../src/infrastructure/postgres-outbox-schema.js";
import { maintainOutboxPartitions } from "../src/infrastructure/postgres-outbox-partition-maintenance.js";
import { createTestDatabase, type TestDatabase } from "../test-support/test-database.js";
import { measure, writeBaseline } from "./harness.js";

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
  await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") });
  // Prime create-ahead once so every measured call is a steady-state no-op.
  await maintainOutboxPartitions(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") });
});

describe("bench: partition maintenance", () => {
  it("runs create-ahead when partitions already exist (steady state)", async () => {
    const stats = await measure(
      "partition-maintenance-steady-state",
      async () => {
        await maintainOutboxPartitions(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") });
      },
      { iterations: 50, warmup: 5 },
    );
    writeBaseline(stats);
  }, 120_000);
});
