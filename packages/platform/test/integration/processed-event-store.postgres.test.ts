/**
 * Real-Postgres integration tests for E03-T14. The shared
 * `ProcessedEventStore` contract suite (`@corestack/kernel/testing`, E04)
 * proves `PostgresProcessedEventStore` satisfies the exact same behavioral
 * contract kernel's own `InMemoryProcessedEventStore` proves — invoked
 * exactly once per (consumer, event id) across redelivery, a failed
 * handler leaves the event unmarked and retryable, scope isolation — no
 * hand-mirrored duplicate needed. This file then proves the
 * Postgres-specific angle no in-memory store can: genuine same-transaction
 * atomicity between a handler's own state change and the processed-event
 * mark.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createContext, createEvent, FixedClock, UuidGenerator, type DomainEvent } from "@corestack/kernel";
import {
  defineProcessedEventStoreContractSuite,
  type SuiteHarness,
} from "@corestack/kernel/testing";
import type { Sql } from "postgres";

import { ensureOutboxSchema } from "../../src/infrastructure/postgres-outbox-schema.js";
import { PostgresProcessedEventStore } from "../../src/infrastructure/postgres-processed-event-store.js";
import { createTestDatabase, type TestDatabase } from "../../test-support/test-database.js";

let db: TestDatabase;
let sql: Sql;

const ids = new UuidGenerator();

function makeEvent(): DomainEvent {
  const clock = new FixedClock(new Date("2026-07-28T00:00:00Z"));
  const context = createContext({ actor: { type: "system", id: null } }, ids);
  return createEvent({ name: "fixture.thing.happened", version: 1, payload: {} }, context, {
    clock,
    ids,
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
  await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-28T00:00:00Z") });
  await sql.unsafe(`DROP TABLE IF EXISTS invoices`);
  await sql.unsafe(`CREATE TABLE invoices (id uuid PRIMARY KEY)`);
});

const harness: SuiteHarness = { describe, it, expect, beforeEach, afterEach };

describe("PostgresProcessedEventStore via the shared ProcessedEventStore contract suite", () => {
  defineProcessedEventStoreContractSuite(harness, () => new PostgresProcessedEventStore(sql));
});

describe("PostgresProcessedEventStore (E03-T14 integration, Postgres-specific)", () => {
  it("bound to an open transaction, markProcessed commits atomically with the handler's own state change", async () => {
    const invoiceId = randomUUID();
    const event = makeEvent();

    await sql.begin(async (tx) => {
      const store = new PostgresProcessedEventStore(tx);
      await tx`INSERT INTO invoices (id) VALUES (${invoiceId})`;
      await store.markProcessed("invoicing", event.id);
    });

    const invoiceRows = await sql`SELECT id FROM invoices WHERE id = ${invoiceId}`;
    const marked = await new PostgresProcessedEventStore(sql).hasProcessed("invoicing", event.id);
    expect(invoiceRows).toHaveLength(1);
    expect(marked).toBe(true);
  });

  it("bound to an open transaction, a later throw rolls back both the state change and the mark together", async () => {
    const invoiceId = randomUUID();
    const event = makeEvent();

    await expect(
      sql.begin(async (tx) => {
        const store = new PostgresProcessedEventStore(tx);
        await tx`INSERT INTO invoices (id) VALUES (${invoiceId})`;
        await store.markProcessed("invoicing", event.id);
        throw new Error("simulated failure after marking, before commit");
      }),
    ).rejects.toThrow("simulated failure after marking, before commit");

    const invoiceRows = await sql`SELECT id FROM invoices WHERE id = ${invoiceId}`;
    const marked = await new PostgresProcessedEventStore(sql).hasProcessed("invoicing", event.id);
    expect(invoiceRows).toHaveLength(0);
    expect(marked).toBe(false);
  });

  it("concurrent callers racing to mark the same (consumer, event id) never error — ON CONFLICT DO NOTHING absorbs the race", async () => {
    const store = new PostgresProcessedEventStore(sql);
    const event = makeEvent();

    // Only meaningful against real shared storage: a single-threaded
    // in-memory Set can't race with itself, so this stays a
    // Postgres-specific adjunct, not part of the portable suite.
    await Promise.all(
      Array.from({ length: 10 }, () => store.markProcessed("audit", event.id)),
    );

    expect(await store.hasProcessed("audit", event.id)).toBe(true);
  });
});
