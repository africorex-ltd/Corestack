/**
 * Benchmark: processed-event inserts (E03-T14). Measures
 * PostgresProcessedEventStore.markProcessed against real Postgres — the
 * dedupe write every idempotent consumer performs after handling an
 * event. No threshold assertions — see docs/quality/architecture-benchmarks/
 * outbox-benchmark-methodology.md.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";

import { ensureOutboxSchema } from "../src/infrastructure/postgres-outbox-schema.js";
import { PostgresProcessedEventStore } from "../src/infrastructure/postgres-processed-event-store.js";
import { measure, writeBaseline } from "./harness.js";

let container: StartedPostgreSqlContainer;
let sql: Sql;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri(), { max: 5, onnotice: () => {} });
}, 120_000);

afterAll(async () => {
  await sql?.end();
  await container?.stop();
});

beforeEach(async () => {
  await sql.unsafe(`DROP SCHEMA IF EXISTS platform CASCADE`);
  await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") });
});

describe("bench: processed-event inserts", () => {
  it("marks a fresh event id processed repeatedly (never hits the ON CONFLICT path)", async () => {
    const store = new PostgresProcessedEventStore(sql);

    const stats = await measure(
      "processed-event-mark",
      async () => {
        await store.markProcessed("bench-consumer", randomUUID());
      },
      { iterations: 50, warmup: 5 },
    );
    writeBaseline(stats);
  }, 120_000);
});
