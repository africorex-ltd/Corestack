/**
 * Crash-consistency test suite for the outbox (E03-T13; Architecture
 * §44.5): "kill the process mid-use-case, assert no lost/duplicated
 * effects after restart." Exercises the full pipeline built across
 * T10 (schema), T11 (writer), and T12 (relay) together — not any one
 * piece in isolation — through the three scenarios the blueprint names
 * explicitly:
 *
 *   1. Crash before commit
 *   2. Crash after commit, before dispatch (pre-dispatch)
 *   3. Crash mid-dispatch (partway through relay processing)
 *
 * Each scenario is proven by literally discarding and reconstructing the
 * relevant objects (transaction, relay, store) between phases — never by
 * calling a method twice on one long-lived instance — since a weaker test
 * could pass by accident on in-memory state that a real crash would wipe.
 *
 * Deferred, not skipped: E04-T01 ("contract-suite framework") will let
 * these scenarios be declared once and run against any `UnitOfWork` +
 * `OutboxRelayStore` pair, not just the Postgres ones built so far — that
 * framework doesn't exist yet, so this suite is Postgres-only for now,
 * matching every other adapter's posture in this package to date.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createContext,
  createEvent,
  FixedClock,
  UuidGenerator,
  type DomainEvent,
  type EventSubscription,
} from "@corestack/kernel";
import postgres, { type Sql } from "postgres";

import { ensureOutboxSchema } from "../../src/infrastructure/postgres-outbox-schema.js";
import { writeOutboxEvents } from "../../src/infrastructure/postgres-outbox-writer.js";
import { PostgresOutboxRelayStore } from "../../src/infrastructure/postgres-outbox-relay-store.js";
import { OutboxRelay } from "../../src/application/outbox-relay.js";

let container: StartedPostgreSqlContainer;
let sql: Sql;

const ids = new UuidGenerator();

function makeEvent(payload: unknown): DomainEvent {
  const clock = new FixedClock(new Date("2026-07-15T12:00:00Z"));
  const context = createContext({ actor: { type: "system", id: null } }, ids);
  return createEvent({ name: "billing.invoice.issued", version: 1, payload }, context, {
    clock,
    ids,
  });
}

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
  // These two live outside `platform`, so dropping that schema alone
  // doesn't reset them — drop them explicitly each test, otherwise rows
  // from an earlier scenario leak into the next one's assertions.
  await sql.unsafe(`DROP TABLE IF EXISTS invoices, delivered_effects`);
  await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") });
  await sql.unsafe(`CREATE TABLE invoices (id uuid PRIMARY KEY)`);
  // A minimal, ad-hoc idempotent effect log — standing in for E03-T14's
  // production dedupe helper, which doesn't exist yet. Proves the
  // *contract* (at-least-once delivery + an idempotent handler = no
  // duplicated effects), independent of which helper eventually enforces it.
  await sql.unsafe(
    `CREATE TABLE delivered_effects (event_id uuid PRIMARY KEY, invoice_id uuid NOT NULL)`,
  );
});

describe("outbox crash consistency (E03-T13)", () => {
  it("scenario 1 — crash before commit: neither the state change nor the event survive", async () => {
    const invoiceId = randomUUID();
    const event = makeEvent({ invoiceId });

    await expect(
      sql.begin(async (tx) => {
        await tx`INSERT INTO invoices (id) VALUES (${invoiceId})`;
        await writeOutboxEvents(tx, [event]);
        throw new Error("simulated crash before commit");
      }),
    ).rejects.toThrow("simulated crash before commit");

    const invoiceRows = await sql`SELECT id FROM invoices WHERE id = ${invoiceId}`;
    const outboxRows = await sql`SELECT id FROM platform.outbox WHERE id = ${event.id}`;
    expect(invoiceRows).toHaveLength(0);
    expect(outboxRows).toHaveLength(0);
  });

  it("scenario 2 — crash after commit, before any dispatch: the committed event is not lost and is delivered exactly once by a later relay", async () => {
    const invoiceId = randomUUID();
    const event = makeEvent({ invoiceId });

    // The use case fully commits — this *is* the crash-safety boundary the
    // outbox pattern buys: once this resolves, both effects are durable
    // even though nothing has read or dispatched the event yet.
    await sql.begin(async (tx) => {
      await tx`INSERT INTO invoices (id) VALUES (${invoiceId})`;
      await writeOutboxEvents(tx, [event]);
    });

    const invoiceRows = await sql`SELECT id FROM invoices WHERE id = ${invoiceId}`;
    expect(invoiceRows).toHaveLength(1);

    // "Process restart": a relay that never existed before this point
    // starts up fresh and must find + deliver the committed event.
    const delivered: string[] = [];
    const subscription: EventSubscription = {
      consumer: "invoicing-audit",
      event: "billing.invoice.issued",
      handler: async (deliveredEvent) => {
        await sql`
          INSERT INTO delivered_effects (event_id, invoice_id) VALUES (${deliveredEvent.id}, ${invoiceId})
          ON CONFLICT (event_id) DO NOTHING
        `;
        delivered.push(deliveredEvent.id);
      },
    };
    const relay = new OutboxRelay({
      store: new PostgresOutboxRelayStore(sql),
      subscriptions: [subscription],
      pollIntervalMs: 1000,
    });
    await relay.pollOnce();

    expect(delivered).toEqual([event.id]);
    const effects = await sql`SELECT event_id FROM delivered_effects WHERE event_id = ${event.id}`;
    expect(effects).toHaveLength(1);
  });

  it("scenario 3 — crash mid-dispatch: no event is lost, and an idempotent handler produces no duplicated effects on redelivery", async () => {
    const invoices = Array.from({ length: 4 }, () => randomUUID());
    const events = invoices.map((invoiceId) => makeEvent({ invoiceId }));

    await sql.begin(async (tx) => {
      for (const invoiceId of invoices) {
        await tx`INSERT INTO invoices (id) VALUES (${invoiceId})`;
      }
      await writeOutboxEvents(tx, events);
    });

    // First relay: processes events 1-2, then "crashes" (throws) on event 3.
    // Its process — and every in-memory thing it knew — is gone afterward.
    const firstPassDelivered: string[] = [];
    const crashingSubscription: EventSubscription = {
      consumer: "invoicing-audit",
      event: "billing.invoice.issued",
      handler: async (event) => {
        const index = events.findIndex((e) => e.id === event.id);
        if (index === 2) throw new Error("simulated crash mid-dispatch");
        await sql`
          INSERT INTO delivered_effects (event_id, invoice_id) VALUES (${event.id}, ${(event.payload as { invoiceId: string }).invoiceId})
          ON CONFLICT (event_id) DO NOTHING
        `;
        firstPassDelivered.push(event.id);
      },
    };
    {
      const relay = new OutboxRelay({
        store: new PostgresOutboxRelayStore(sql),
        subscriptions: [crashingSubscription],
        pollIntervalMs: 1000,
      });
      await relay.pollOnce();
    }
    expect(firstPassDelivered).toEqual([events[0]?.id, events[1]?.id]);

    // Fresh relay + store + subscription (the "redeploy after the fix"),
    // idempotent via ON CONFLICT DO NOTHING on delivered_effects.
    const secondPassDelivered: string[] = [];
    const recoveredSubscription: EventSubscription = {
      consumer: "invoicing-audit",
      event: "billing.invoice.issued",
      handler: async (event) => {
        await sql`
          INSERT INTO delivered_effects (event_id, invoice_id) VALUES (${event.id}, ${(event.payload as { invoiceId: string }).invoiceId})
          ON CONFLICT (event_id) DO NOTHING
        `;
        secondPassDelivered.push(event.id);
      },
    };
    {
      const relay = new OutboxRelay({
        store: new PostgresOutboxRelayStore(sql),
        subscriptions: [recoveredSubscription],
        pollIntervalMs: 1000,
      });
      await relay.pollOnce();
    }

    // No lost event: the redelivery starts at the failed event, not
    // wherever the fresh instance guesses — it picks up from the durable
    // checkpoint, so it redelivers 3 and 4, never re-attempting 1 and 2.
    expect(secondPassDelivered).toEqual([events[2]?.id, events[3]?.id]);

    // No duplicated effects: exactly one delivered_effects row per event,
    // for all 4 events, even though event 3 was attempted twice (once in
    // the crashing pass, once in the recovered pass) — the ON CONFLICT DO
    // NOTHING made the *attempt* idempotent, matching the outbox's
    // at-least-once contract.
    const effectRows = await sql`SELECT event_id FROM delivered_effects ORDER BY event_id`;
    expect(effectRows.map((r) => r.event_id).sort()).toEqual(events.map((e) => e.id).sort());
  });
});
