/**
 * Real-Postgres integration test for E03-T33, matching the blueprint's
 * exact acceptance criterion: "Fixture module's purge handler invoked
 * exactly once, idempotent on replay." `registerPurgeHandler` composes
 * already-shipped primitives (kernel's `idempotentHandler`, E03-T14's
 * `PostgresProcessedEventStore`) — T14's own integration suite already
 * proves that composition's dedup behavior generically; this test proves
 * `registerPurgeHandler` wires it correctly for the purge-specific
 * consumer name and organizationId extraction, durably, not just against
 * an in-memory store.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createContext, createEvent, FixedClock, UuidGenerator } from "@corestack/kernel";
import type { Sql } from "postgres";

import { ensureOutboxSchema } from "../../src/infrastructure/postgres-outbox-schema.js";
import { PostgresProcessedEventStore } from "../../src/infrastructure/postgres-processed-event-store.js";
import {
  ORGANIZATION_PURGE_REQUESTED_EVENT,
  registerPurgeHandler,
} from "../../src/application/purge-protocol.js";
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
  await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-29T00:00:00Z") });
});

describe("registerPurgeHandler (E03-T33 integration)", () => {
  it("invokes the fixture module's purge handler exactly once across redelivery of the same purge event", async () => {
    const store = new PostgresProcessedEventStore(sql);
    const purgedOrganizations: string[] = [];

    const subscription = registerPurgeHandler(
      "fixture",
      async (organizationId) => {
        purgedOrganizations.push(organizationId);
      },
      store,
    );
    expect(subscription.consumer).toBe("fixture:purge");
    expect(subscription.event).toBe(ORGANIZATION_PURGE_REQUESTED_EVENT);

    const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));
    const context = createContext(
      { actor: { type: "system", id: null }, organizationId: "org-to-delete" },
      ids,
    );
    const event = createEvent(
      { name: ORGANIZATION_PURGE_REQUESTED_EVENT, version: 1, payload: {} },
      context,
      { clock, ids },
    );

    // First delivery: the fixture module actually purges.
    await subscription.handler(event);
    // Redelivery of the exact same event (the outbox relay's at-least-once
    // guarantee means this is expected, not a bug) — must be a no-op.
    await subscription.handler(event);
    await subscription.handler(event);

    expect(purgedOrganizations).toEqual(["org-to-delete"]);
  });

  it("a failed purge attempt is not marked complete and is retried on redelivery", async () => {
    const store = new PostgresProcessedEventStore(sql);
    let attempts = 0;

    const subscription = registerPurgeHandler(
      "fixture",
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient failure on first attempt");
      },
      store,
    );

    const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));
    const context = createContext(
      { actor: { type: "system", id: null }, organizationId: "org-to-delete" },
      ids,
    );
    const event = createEvent(
      { name: ORGANIZATION_PURGE_REQUESTED_EVENT, version: 1, payload: {} },
      context,
      { clock, ids },
    );

    await expect(subscription.handler(event)).rejects.toThrow("transient failure");
    expect(await store.hasProcessed("fixture:purge", event.id)).toBe(false);

    await subscription.handler(event); // retry succeeds
    expect(attempts).toBe(2);
    expect(await store.hasProcessed("fixture:purge", event.id)).toBe(true);
  });
});
