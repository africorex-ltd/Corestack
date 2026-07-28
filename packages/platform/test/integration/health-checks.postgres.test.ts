/**
 * Real-Postgres integration tests for E03-T23's Postgres adapters:
 * `PostgresDatabasePing`/`PostgresMigrationsStatus`
 * (postgres-health-checks.ts) and `PostgresOutboxRelayStore.countBacklog`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createContext, createEvent, FixedClock, UuidGenerator } from "@corestack/kernel";
import type { Sql } from "postgres";

import { ensureMigrationTrackingSchema } from "../../src/infrastructure/postgres-migration-runner-store.js";
import { ensureOutboxSchema } from "../../src/infrastructure/postgres-outbox-schema.js";
import { writeOutboxEvents } from "../../src/infrastructure/postgres-outbox-writer.js";
import { PostgresOutboxRelayStore } from "../../src/infrastructure/postgres-outbox-relay-store.js";
import {
  PostgresDatabasePing,
  PostgresMigrationsStatus,
} from "../../src/infrastructure/postgres-health-checks.js";
import { createTestDatabase, type TestDatabase } from "../../test-support/test-database.js";

let db: TestDatabase;
let sql: Sql;

const ids = new UuidGenerator();

beforeAll(async () => {
  db = await createTestDatabase();
  sql = db.sql;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await sql.unsafe(`DROP SCHEMA IF EXISTS platform CASCADE`);
  await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-28T00:00:00Z") });
});

describe("PostgresDatabasePing (E03-T23 integration)", () => {
  it("pings successfully and reports a non-negative latency", async () => {
    const ping = new PostgresDatabasePing(sql);
    const result = await ping.ping();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns the database server's own clock, not the local one", async () => {
    const ping = new PostgresDatabasePing(sql);
    const dbNow = await ping.now();
    expect(dbNow).toBeInstanceOf(Date);
    // Sanity bound: the DB clock should be within a generous window of
    // local wall-clock time (proves it's a real timestamp, not a fixture).
    expect(Math.abs(dbNow.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("rejects when the connection is already closed", async () => {
    const scratch = await createTestDatabase();
    const ping = new PostgresDatabasePing(scratch.sql);
    await scratch.close();
    await expect(ping.ping()).rejects.toThrow();
  }, 30_000);
});

describe("PostgresMigrationsStatus (E03-T23 integration)", () => {
  it("returns an empty map when no module has ever migrated", async () => {
    await ensureMigrationTrackingSchema(sql);
    const status = new PostgresMigrationsStatus(sql);
    const applied = await status.appliedVersions();
    expect(applied.size).toBe(0);
  });

  it("reports each module's applied version once migrations exist", async () => {
    await ensureMigrationTrackingSchema(sql);
    await sql`
      INSERT INTO platform.module_migrations (module, version, applied_at, checksum)
      VALUES ('tenancy', 3, now(), 'abc'), ('billing', 1, now(), 'def')
    `;
    const status = new PostgresMigrationsStatus(sql);
    const applied = await status.appliedVersions();
    expect(applied.get("tenancy")).toBe(3);
    expect(applied.get("billing")).toBe(1);
  });
});

describe("PostgresOutboxRelayStore.countBacklog (E03-T23 integration)", () => {
  function makeEvent(occurredAt: Date): ReturnType<typeof createEvent> {
    const clock = new FixedClock(occurredAt);
    const context = createContext({ actor: { type: "system", id: null } }, ids);
    return createEvent({ name: "fixture.thing.happened", version: 1, payload: {} }, context, {
      clock,
      ids,
    });
  }

  it("counts the full outbox when the consumer has no checkpoint yet", async () => {
    await writeOutboxEvents(sql, [
      makeEvent(new Date("2026-07-28T00:00:00Z")),
      makeEvent(new Date("2026-07-28T00:00:01Z")),
      makeEvent(new Date("2026-07-28T00:00:02Z")),
    ]);
    const store = new PostgresOutboxRelayStore(sql);
    expect(await store.countBacklog("fresh-consumer")).toBe(3);
  });

  it("counts only rows strictly after the consumer's checkpoint", async () => {
    const events = [
      makeEvent(new Date("2026-07-28T00:00:00Z")),
      makeEvent(new Date("2026-07-28T00:00:01Z")),
      makeEvent(new Date("2026-07-28T00:00:02Z")),
    ];
    await writeOutboxEvents(sql, events);
    const store = new PostgresOutboxRelayStore(sql);
    await store.advanceCheckpoint("audit", {
      occurredAt: events[0]!.occurredAt,
      id: events[0]!.id,
    });
    expect(await store.countBacklog("audit")).toBe(2);
  });

  it("returns 0 once the consumer is fully caught up", async () => {
    const event = makeEvent(new Date("2026-07-28T00:00:00Z"));
    await writeOutboxEvents(sql, [event]);
    const store = new PostgresOutboxRelayStore(sql);
    await store.advanceCheckpoint("audit", { occurredAt: event.occurredAt, id: event.id });
    expect(await store.countBacklog("audit")).toBe(0);
  });
});
