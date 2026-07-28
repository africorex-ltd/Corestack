/**
 * Real-Postgres integration tests for E03-T11 (Testcontainers). Proves the
 * outbox writer's whole reason to exist: events staged via `publish` land
 * in `platform.outbox` atomically with whatever else runs in the same
 * transaction — a rollback discards both, not just one.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createContext, createEvent, FixedClock, UuidGenerator } from "@corestack/kernel";
import type { DomainEvent } from "@corestack/kernel";
import type { Sql } from "postgres";

import { ensureOutboxSchema } from "../../src/infrastructure/postgres-outbox-schema.js";
import {
  createOutboxStaging,
  writeOutboxEvents,
} from "../../src/infrastructure/postgres-outbox-writer.js";
import { createTestDatabase, type TestDatabase } from "../../test-support/test-database.js";

let db: TestDatabase;
let sql: Sql;

const clock = new FixedClock(new Date("2026-07-15T12:00:00Z"));
const ids = new UuidGenerator();

function makeEvent(payload: unknown = { ok: true }): DomainEvent {
  const context = createContext(
    { actor: { type: "system", id: null }, organizationId: randomUUID() },
    ids,
  );
  return createEvent({ name: "tenancy.member.invited", version: 1, payload }, context, {
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
  await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") });
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS scratch_state (id uuid PRIMARY KEY)`);
});

describe("writeOutboxEvents / createOutboxStaging (E03-T11 integration)", () => {
  it("inserts a batch of events directly given a bare pool handle", async () => {
    const events = [makeEvent(), makeEvent()];
    await writeOutboxEvents(sql, events);

    const rows = await sql`SELECT id FROM platform.outbox ORDER BY id`;
    expect(rows.map((r) => r.id)).toEqual([events[0]?.id, events[1]?.id].sort());
  });

  it("is a no-op for an empty batch", async () => {
    await expect(writeOutboxEvents(sql, [])).resolves.toBeUndefined();
    const rows = await sql`SELECT id FROM platform.outbox`;
    expect(rows).toHaveLength(0);
  });

  it("commits events atomically with a state change in the same transaction", async () => {
    const stateId = randomUUID();
    const event = makeEvent();

    await sql.begin(async (tx) => {
      await tx`INSERT INTO scratch_state (id) VALUES (${stateId})`;
      await writeOutboxEvents(tx, [event]);
    });

    const state = await sql`SELECT id FROM scratch_state WHERE id = ${stateId}`;
    const outbox = await sql`SELECT id FROM platform.outbox WHERE id = ${event.id}`;
    expect(state).toHaveLength(1);
    expect(outbox).toHaveLength(1);
  });

  it("rolls back the outbox insert along with the state change when the transaction throws", async () => {
    const stateId = randomUUID();
    const event = makeEvent();

    await expect(
      sql.begin(async (tx) => {
        await tx`INSERT INTO scratch_state (id) VALUES (${stateId})`;
        await writeOutboxEvents(tx, [event]);
        throw new Error("boom — simulated use-case failure after staging events");
      }),
    ).rejects.toThrow("boom");

    const state = await sql`SELECT id FROM scratch_state WHERE id = ${stateId}`;
    const outbox = await sql`SELECT id FROM platform.outbox WHERE id = ${event.id}`;
    expect(state).toHaveLength(0);
    expect(outbox).toHaveLength(0);
  });

  it("createOutboxStaging bridges tx.publish to a flush inside the same transaction, discarded on rollback", async () => {
    const stateId = randomUUID();
    const event = makeEvent();
    const staging = createOutboxStaging();
    staging.tx.publish(event);

    await expect(
      sql.begin(async (tx) => {
        await tx`INSERT INTO scratch_state (id) VALUES (${stateId})`;
        await staging.flush(tx);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const outbox = await sql`SELECT id FROM platform.outbox WHERE id = ${event.id}`;
    expect(outbox).toHaveLength(0);

    // The same staging instance, flushed against a transaction that
    // commits, proves the happy path too — staged events aren't
    // single-use or tied to the failed attempt above.
    await sql.begin(async (tx) => {
      await staging.flush(tx);
    });
    const committed = await sql`SELECT id FROM platform.outbox WHERE id = ${event.id}`;
    expect(committed).toHaveLength(1);
  });

  it("round-trips a nested, non-ASCII, null-containing payload through jsonb exactly", async () => {
    const payload = {
      nested: { count: 3, tags: ["a", "b"] },
      empty: {},
      missing: null,
      label: "héllo wörld — 日本語",
    };
    const event = makeEvent(payload);
    await writeOutboxEvents(sql, [event]);

    const rows = await sql`SELECT payload FROM platform.outbox WHERE id = ${event.id}`;
    expect(rows[0]?.payload).toEqual(payload);
  });
});
