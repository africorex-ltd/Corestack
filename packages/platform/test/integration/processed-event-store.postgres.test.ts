/**
 * Real-Postgres integration tests for E03-T14. First proves
 * `PostgresProcessedEventStore` satisfies the exact same behavioral
 * contract the kernel already verifies for `InMemoryProcessedEventStore`
 * (packages/kernel/test/unit-of-work.test.ts's `idempotentHandler`
 * suite) — invoked exactly once per (consumer, event id) across
 * redelivery, and a failed handler leaves the event unmarked and
 * retryable. Then proves the Postgres-specific angle no in-memory store
 * can: genuine same-transaction atomicity between a handler's own state
 * change and the processed-event mark.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createContext,
  createEvent,
  FixedClock,
  idempotentHandler,
  UuidGenerator,
  type DomainEvent,
} from "@corestack/kernel";
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

describe("PostgresProcessedEventStore (E03-T14 integration)", () => {
  it("hasProcessed is false before markProcessed and true after — the port's basic contract", async () => {
    const store = new PostgresProcessedEventStore(sql);
    const event = makeEvent();

    expect(await store.hasProcessed("audit", event.id)).toBe(false);
    await store.markProcessed("audit", event.id);
    expect(await store.hasProcessed("audit", event.id)).toBe(true);
  });

  it("markProcessed is idempotent: marking the same (consumer, event id) twice does not error", async () => {
    const store = new PostgresProcessedEventStore(sql);
    const event = makeEvent();

    await store.markProcessed("audit", event.id);
    await expect(store.markProcessed("audit", event.id)).resolves.toBeUndefined();
  });

  it("via idempotentHandler: invokes the handler exactly once per (consumer, event id), replay is a no-op", async () => {
    const store = new PostgresProcessedEventStore(sql);
    let calls = 0;
    const handler = idempotentHandler("audit", store, () => {
      calls += 1;
    });

    const event = makeEvent();
    await handler(event);
    await handler(event); // redelivery

    expect(calls).toBe(1);
  });

  it("via idempotentHandler: a failed event stays unmarked and is retried on redelivery (at-least-once, not at-most-once)", async () => {
    const store = new PostgresProcessedEventStore(sql);
    let attempts = 0;
    const handler = idempotentHandler("audit", store, () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient failure");
    });

    const event = makeEvent();
    await expect(handler(event)).rejects.toThrow("transient failure");
    expect(await store.hasProcessed("audit", event.id)).toBe(false);

    await handler(event); // redelivery succeeds
    expect(attempts).toBe(2);
    expect(await store.hasProcessed("audit", event.id)).toBe(true);
  });

  it("two different consumers have independent processed state for the same event id", async () => {
    const store = new PostgresProcessedEventStore(sql);
    const event = makeEvent();

    await store.markProcessed("audit", event.id);

    expect(await store.hasProcessed("audit", event.id)).toBe(true);
    expect(await store.hasProcessed("billing", event.id)).toBe(false);
  });

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
});
