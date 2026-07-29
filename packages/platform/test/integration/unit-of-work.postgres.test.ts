/**
 * Real-Postgres integration tests for E03-T40's `PostgresUnitOfWork`
 * (ADR-0009's `UnitOfWork` port; ADR-0008 layer 3). No pure unit tests —
 * this adapter has no logic that isn't Postgres transaction orchestration,
 * matching the posture of every other transaction-boundary component in
 * this package (e.g. E03-T13's crash-consistency suite).
 *
 * Every assertion about state changes and `app.current_org` runs its
 * queries through `ctx.sql` (the `PostgresTransactionContext` extension) —
 * never the outer pooled `sql` — since that's a different connection than
 * the one `run()` opened, and would prove nothing about the transaction's
 * actual behavior.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createContext, createEvent, FixedClock, UuidGenerator } from "@corestack/kernel";
import type { Sql } from "postgres";

import { ensureOutboxSchema } from "../../src/infrastructure/postgres-outbox-schema.js";
import {
  PostgresUnitOfWork,
  type PostgresTransactionContext,
} from "../../src/infrastructure/postgres-unit-of-work.js";
import { createTestDatabase, type TestDatabase } from "../../test-support/test-database.js";

let db: TestDatabase;
let sql: Sql;

const ids = new UuidGenerator();

function makeEvent(payload: unknown, organizationId: string | null = null) {
  const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));
  const context = createContext({ actor: { type: "system", id: null }, organizationId }, ids);
  return createEvent({ name: "fixture.thing.happened", version: 1, payload }, context, {
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
  await sql.unsafe(`DROP TABLE IF EXISTS widgets`);
  await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-29T00:00:00Z") });
  await sql.unsafe(`CREATE TABLE widgets (id uuid PRIMARY KEY)`);
});

describe("PostgresUnitOfWork (E03-T40 integration)", () => {
  it("returns the work callback's result", async () => {
    const uow = new PostgresUnitOfWork(sql);
    const result = await uow.run(async () => "done");
    expect(result).toBe("done");
  });

  it("commits staged events into platform.outbox atomically with the work's own writes", async () => {
    const widgetId = randomUUID();
    const event = makeEvent({ widgetId });
    const uow = new PostgresUnitOfWork(sql);

    await uow.run(async (ctx) => {
      await ctx.sql`INSERT INTO widgets (id) VALUES (${widgetId})`;
      ctx.publish(event);
    });

    const widgetRows = await sql`SELECT id FROM widgets WHERE id = ${widgetId}`;
    const outboxRows = await sql`SELECT id FROM platform.outbox WHERE id = ${event.id}`;
    expect(widgetRows).toHaveLength(1);
    expect(outboxRows).toHaveLength(1);
  });

  it("rolls back both the work's own writes and staged events when work throws", async () => {
    const widgetId = randomUUID();
    const event = makeEvent({ widgetId });
    const uow = new PostgresUnitOfWork(sql);

    await expect(
      uow.run(async (ctx) => {
        await ctx.sql`INSERT INTO widgets (id) VALUES (${widgetId})`;
        ctx.publish(event);
        throw new Error("simulated use-case failure");
      }),
    ).rejects.toThrow("simulated use-case failure");

    const widgetRows = await sql`SELECT id FROM widgets WHERE id = ${widgetId}`;
    const outboxRows = await sql`SELECT id FROM platform.outbox WHERE id = ${event.id}`;
    expect(widgetRows).toHaveLength(0);
    expect(outboxRows).toHaveLength(0);
  });

  it("sets app.current_org for the transaction's duration when constructed with an organizationId", async () => {
    const orgId = "11111111-1111-1111-1111-111111111111";
    const uow = new PostgresUnitOfWork(sql, orgId);

    const insideValue = await uow.run(async (ctx) => {
      const rows = await ctx.sql<
        { v: string }[]
      >`SELECT current_setting('app.current_org', true) AS v`;
      ctx.publish(makeEvent({}, orgId));
      return rows[0]?.v;
    });

    expect(insideValue).toBe(orgId);
  });

  it("does not set app.current_org for a platform-scoped instance (organizationId: null)", async () => {
    const uow = new PostgresUnitOfWork(sql, null);

    const insideValue = await uow.run(async (ctx) => {
      const rows = await ctx.sql<
        { v: string | null }[]
      >`SELECT current_setting('app.current_org', true) AS v`;
      return rows[0]?.v;
    });

    // Matches E03-T30's finding: NULL on a session that's never touched the
    // setting, or '' if some earlier test on this pooled connection did —
    // either way, never an org id from another test.
    expect(insideValue === null || insideValue === "").toBe(true);
  });

  it("two sequential run() calls are independent — the second never sees the first's org context", async () => {
    const orgA = "11111111-1111-1111-1111-111111111111";
    const orgB = "22222222-2222-2222-2222-222222222222";

    const uowA = new PostgresUnitOfWork(sql, orgA);
    const seenInA = await uowA.run(async (ctx) => {
      const rows = await ctx.sql<
        { v: string }[]
      >`SELECT current_setting('app.current_org', true) AS v`;
      ctx.publish(makeEvent({}, orgA));
      return rows[0]?.v;
    });
    expect(seenInA).toBe(orgA);

    // A fresh instance, run only after the first has fully committed —
    // genuinely sequential, not nested (nesting isn't supported per the
    // kernel port's own contract: "a use case is the transaction boundary").
    const uowB = new PostgresUnitOfWork(sql, orgB);
    const seenInB = await uowB.run(async (ctx) => {
      const rows = await ctx.sql<
        { v: string }[]
      >`SELECT current_setting('app.current_org', true) AS v`;
      ctx.publish(makeEvent({}, orgB));
      return rows[0]?.v;
    });
    expect(seenInB).toBe(orgB);
  });

  it("SECURITY MATRIX §4.5: nesting a UnitOfWork inside another's run() throws rather than silently succeeding or double-committing", async () => {
    const outerUow = new PostgresUnitOfWork(sql);

    await expect(
      outerUow.run(async (ctx: PostgresTransactionContext) => {
        // Attempting to open a second transaction on the SAME open
        // transaction's connection — TransactionSql has no .begin() (a
        // finding from T31), so this must throw, never silently succeed.
        const innerUow = new PostgresUnitOfWork(ctx.sql as unknown as Sql);
        await innerUow.run(async () => "should never get here");
      }),
    ).rejects.toThrow();
  });
});
