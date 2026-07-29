/**
 * Benchmark: `PostgresUnitOfWork.run` (E03-T40; E04 contract-suite
 * performance baselines). Measures one `run()` call staging a single
 * event — open transaction, stage event into `platform.outbox`, commit —
 * against real Postgres. No threshold assertions — see
 * docs/quality/performance/contract-suite-adapter-benchmark-methodology.md.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { createContext, createEvent, FixedClock, UuidGenerator } from "@corestack/kernel";
import type { Sql } from "postgres";

import { ensureOutboxSchema } from "../src/infrastructure/postgres-outbox-schema.js";
import { PostgresUnitOfWork } from "../src/infrastructure/postgres-unit-of-work.js";
import { createTestDatabase, type TestDatabase } from "../test-support/test-database.js";
import { measure, writeBaseline, PERFORMANCE_BASELINE_DIR } from "./harness.js";

let db: TestDatabase;
let sql: Sql;
const ids = new UuidGenerator();
const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));

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

describe("bench: PostgresUnitOfWork.run", () => {
  it("commits one transaction staging a single event", async () => {
    const uow = new PostgresUnitOfWork(sql);

    const stats = await measure(
      "unit-of-work-run-single-event",
      async () => {
        await uow.run(async (ctx) => {
          const context = createContext({ actor: { type: "system", id: null } }, ids);
          ctx.publish(
            createEvent({ name: "fixture.thing.happened", version: 1, payload: {} }, context, {
              clock,
              ids,
            }),
          );
        });
      },
      { iterations: 50, warmup: 5 },
    );
    writeBaseline(stats, PERFORMANCE_BASELINE_DIR);
  }, 120_000);
});
