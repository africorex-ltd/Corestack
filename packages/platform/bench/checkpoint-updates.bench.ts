/**
 * Benchmark: checkpoint updates (E03-T12). Measures
 * PostgresOutboxRelayStore.advanceCheckpoint against real Postgres —
 * the write every relay poll round performs after a successful batch.
 * No threshold assertions — see docs/quality/architecture-benchmarks/
 * outbox-benchmark-methodology.md.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";

import { ensureOutboxSchema } from "../src/infrastructure/postgres-outbox-schema.js";
import { PostgresOutboxRelayStore } from "../src/infrastructure/postgres-outbox-relay-store.js";
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

describe("bench: checkpoint updates", () => {
  it("advances one consumer's checkpoint repeatedly", async () => {
    const store = new PostgresOutboxRelayStore(sql);
    let occurredAt = new Date("2026-07-15T12:00:00Z").getTime();

    const stats = await measure(
      "checkpoint-advance",
      async () => {
        occurredAt += 1000;
        await store.advanceCheckpoint("bench-consumer", {
          occurredAt: new Date(occurredAt),
          id: randomUUID(),
        });
      },
      { iterations: 50, warmup: 5 },
    );
    writeBaseline(stats);
  }, 120_000);
});
