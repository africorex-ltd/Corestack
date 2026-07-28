/**
 * Real-Postgres integration tests for E03-T03 (Testcontainers). Proves
 * create-ahead, and — the part that matters most — that retention-drop
 * genuinely honors checkpoint safety: a partition is never dropped while
 * any expected consumer hasn't (or may not have) processed past it,
 * including the dangerous case where a consumer has no checkpoint row
 * at all yet.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "postgres";

import { ensureOutboxSchema } from "../../src/infrastructure/postgres-outbox-schema.js";
import { maintainOutboxPartitions } from "../../src/infrastructure/postgres-outbox-partition-maintenance.js";
import { createTestDatabase, type TestDatabase } from "../../test-support/test-database.js";

let db: TestDatabase;
let sql: Sql;

beforeAll(async () => {
  db = await createTestDatabase();
  sql = db.sql;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function listPartitions(): Promise<string[]> {
  const rows = await sql<{ relname: string }[]>`
    SELECT child.relname
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    JOIN pg_namespace ns ON parent.relnamespace = ns.oid
    WHERE ns.nspname = 'platform' AND parent.relname = 'outbox'
    ORDER BY child.relname
  `;
  return rows.map((r) => r.relname);
}

async function setCheckpoint(consumer: string, lastOccurredAt: Date): Promise<void> {
  await sql`
    INSERT INTO platform.outbox_checkpoints (consumer, last_occurred_at, last_event_id, updated_at)
    VALUES (${consumer}, ${lastOccurredAt}, ${randomUUID()}, now())
    ON CONFLICT (consumer) DO UPDATE SET last_occurred_at = EXCLUDED.last_occurred_at
  `;
}

beforeEach(async () => {
  await sql.unsafe(`DROP SCHEMA IF EXISTS platform CASCADE`);
  await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") });
});

describe("maintainOutboxPartitions (E03-T03 integration)", () => {
  it("create-ahead: ensures the next 2 months' partitions exist beyond what the bootstrap created", async () => {
    // ensureOutboxSchema bootstrapped only July + August (monthsAhead: 1).
    const before = await listPartitions();
    expect(before).toEqual(["outbox_2026_07", "outbox_2026_08"]);

    const report = await maintainOutboxPartitions(sql, {
      referenceDate: new Date("2026-07-15T00:00:00Z"),
    });

    expect([...report.created].sort()).toEqual(["outbox_2026_09"]);
    const after = await listPartitions();
    expect(after).toEqual(["outbox_2026_07", "outbox_2026_08", "outbox_2026_09"]);
  });

  it("is idempotent: running twice creates nothing new the second time", async () => {
    await maintainOutboxPartitions(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") });
    const report = await maintainOutboxPartitions(sql, {
      referenceDate: new Date("2026-07-15T00:00:00Z"),
    });
    expect(report.created).toEqual([]);
  });

  it("without retentionMonths, never drops anything even if old partitions exist", async () => {
    // Manufacture an old partition directly (simulating one that's aged out).
    await sql.unsafe(
      `CREATE TABLE platform.outbox_2025_01 PARTITION OF platform.outbox FOR VALUES FROM ('2025-01-01+00') TO ('2025-02-01+00')`,
    );

    const report = await maintainOutboxPartitions(sql, {
      referenceDate: new Date("2026-07-15T00:00:00Z"),
    });

    expect(report.dropped).toEqual([]);
    expect(await listPartitions()).toContain("outbox_2025_01");
  });

  it("the dangerous case: a fresh deploy with an old partition and zero checkpoint rows drops nothing", async () => {
    await sql.unsafe(
      `CREATE TABLE platform.outbox_2025_01 PARTITION OF platform.outbox FOR VALUES FROM ('2025-01-01+00') TO ('2025-02-01+00')`,
    );
    // No checkpoint rows exist at all — the relay has never run.

    const report = await maintainOutboxPartitions(sql, {
      referenceDate: new Date("2026-07-15T00:00:00Z"),
      retentionMonths: 6,
      expectedConsumers: ["audit"],
    });

    expect(report.dropped).toEqual([]);
    expect(report.blocked).toEqual([
      { name: "outbox_2025_01", reason: 'consumer "audit" has not processed past this partition' },
    ]);
    expect(await listPartitions()).toContain("outbox_2025_01");
  });

  it("drops a retention-eligible partition once every expected consumer has passed it, and prunes its processed_events rows", async () => {
    await sql.unsafe(
      `CREATE TABLE platform.outbox_2025_01 PARTITION OF platform.outbox FOR VALUES FROM ('2025-01-01+00') TO ('2025-02-01+00')`,
    );
    const eventId = randomUUID();
    await sql`INSERT INTO platform.outbox_2025_01 (id, event_name, event_version, occurred_at, actor_type, correlation_id, payload)
      VALUES (${eventId}, 'fixture.thing.happened', 1, '2025-01-15T00:00:00Z', 'system', ${randomUUID()}, '{}')`;
    await sql`INSERT INTO platform.processed_events (consumer, event_id, processed_at)
      VALUES ('audit', ${eventId}, now())`;

    await setCheckpoint("audit", new Date("2026-01-01T00:00:00Z"));

    const report = await maintainOutboxPartitions(sql, {
      referenceDate: new Date("2026-07-15T00:00:00Z"),
      retentionMonths: 6,
      expectedConsumers: ["audit"],
    });

    expect(report.dropped).toEqual(["outbox_2025_01"]);
    expect(await listPartitions()).not.toContain("outbox_2025_01");

    const remainingProcessedEvents = await sql`
      SELECT event_id FROM platform.processed_events WHERE event_id = ${eventId}
    `;
    expect(remainingProcessedEvents).toHaveLength(0);
  });

  it("a lagging second consumer blocks the drop even though the first is fully caught up", async () => {
    await sql.unsafe(
      `CREATE TABLE platform.outbox_2025_01 PARTITION OF platform.outbox FOR VALUES FROM ('2025-01-01+00') TO ('2025-02-01+00')`,
    );
    await setCheckpoint("audit", new Date("2026-01-01T00:00:00Z"));
    // "billing" is expected but has no checkpoint row yet.

    const report = await maintainOutboxPartitions(sql, {
      referenceDate: new Date("2026-07-15T00:00:00Z"),
      retentionMonths: 6,
      expectedConsumers: ["audit", "billing"],
    });

    expect(report.dropped).toEqual([]);
    expect(report.blocked[0]?.reason).toContain("billing");
    expect(await listPartitions()).toContain("outbox_2025_01");
  });

  it("processed_events for a partition blocked from dropping are NOT pruned (gated on actual drop, not configured retention)", async () => {
    await sql.unsafe(
      `CREATE TABLE platform.outbox_2025_01 PARTITION OF platform.outbox FOR VALUES FROM ('2025-01-01+00') TO ('2025-02-01+00')`,
    );
    const eventId = randomUUID();
    await sql`INSERT INTO platform.outbox_2025_01 (id, event_name, event_version, occurred_at, actor_type, correlation_id, payload)
      VALUES (${eventId}, 'fixture.thing.happened', 1, '2025-01-15T00:00:00Z', 'system', ${randomUUID()}, '{}')`;
    await sql`INSERT INTO platform.processed_events (consumer, event_id, processed_at)
      VALUES ('audit', ${eventId}, now())`;
    // No checkpoint for "audit" — the partition is blocked, not dropped.

    await maintainOutboxPartitions(sql, {
      referenceDate: new Date("2026-07-15T00:00:00Z"),
      retentionMonths: 6,
      expectedConsumers: ["audit"],
    });

    const stillThere =
      await sql`SELECT event_id FROM platform.processed_events WHERE event_id = ${eventId}`;
    expect(stillThere).toHaveLength(1);
  });
});
