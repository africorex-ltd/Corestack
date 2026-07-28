/**
 * Benchmark: writeOutboxEvents (E03-T11). Measures inserting a fixed-size
 * batch of events into `platform.outbox` against real Postgres. No
 * threshold assertions — see docs/quality/architecture-benchmarks/
 * outbox-benchmark-methodology.md.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { createContext, createEvent, FixedClock, UuidGenerator } from "@corestack/kernel";
import type { DomainEvent } from "@corestack/kernel";
import type { Sql } from "postgres";

import { ensureOutboxSchema } from "../src/infrastructure/postgres-outbox-schema.js";
import { writeOutboxEvents } from "../src/infrastructure/postgres-outbox-writer.js";
import { createTestDatabase, type TestDatabase } from "../test-support/test-database.js";
import { measure, writeBaseline } from "./harness.js";

let db: TestDatabase;
let sql: Sql;

const clock = new FixedClock(new Date("2026-07-15T12:00:00Z"));
const ids = new UuidGenerator();

function makeBatch(size: number): DomainEvent[] {
  return Array.from({ length: size }, () => {
    const context = createContext(
      { actor: { type: "system", id: null }, organizationId: randomUUID() },
      ids,
    );
    return createEvent(
      { name: "tenancy.member.invited", version: 1, payload: { ok: true } },
      context,
      { clock, ids },
    );
  });
}

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
});

describe("bench: writeOutboxEvents", () => {
  it("inserts a 10-event batch", async () => {
    const stats = await measure(
      "write-outbox-events-batch-10",
      async () => {
        await writeOutboxEvents(sql, makeBatch(10));
      },
      { iterations: 50, warmup: 5 },
    );
    writeBaseline(stats);
  }, 120_000);
});
