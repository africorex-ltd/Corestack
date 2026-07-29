/**
 * Benchmark: `PostgresProcessedEventStore.markProcessed` (E03-T14; E04
 * contract-suite performance baselines). Measures one `markProcessed`
 * call against real Postgres, always via the `INSERT` path (a fresh event
 * id each call, never `ON CONFLICT DO NOTHING`) — the outbox subsystem's
 * own `processed-event-inserts.bench.ts` already measures this exact
 * operation for the outbox baseline; this file re-measures it under
 * `docs/quality/performance/` so the E04 contract-suite adapter set is
 * self-contained and doesn't require cross-referencing the outbox
 * baselines for one of its own ports. No threshold assertions — see
 * docs/quality/performance/contract-suite-adapter-benchmark-methodology.md.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import type { Sql } from "postgres";

import { ensureOutboxSchema } from "../src/infrastructure/postgres-outbox-schema.js";
import { PostgresProcessedEventStore } from "../src/infrastructure/postgres-processed-event-store.js";
import { createTestDatabase, type TestDatabase } from "../test-support/test-database.js";
import { measure, writeBaseline, PERFORMANCE_BASELINE_DIR } from "./harness.js";

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
  await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-29T00:00:00Z") });
});

describe("bench: PostgresProcessedEventStore.markProcessed", () => {
  it("marks a fresh event id each call", async () => {
    const store = new PostgresProcessedEventStore(sql);

    const stats = await measure(
      "processed-event-store-mark-fresh-id",
      async () => {
        await store.markProcessed("audit", randomUUID());
      },
      { iterations: 50, warmup: 5 },
    );
    writeBaseline(stats, PERFORMANCE_BASELINE_DIR);
  }, 120_000);
});
