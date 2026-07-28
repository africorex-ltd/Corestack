/**
 * Real-Postgres integration tests for E03-T10 (Testcontainers). Proves the
 * outbox is genuinely partitioned (not a plain table pretending to be),
 * that the +1-month-ahead bootstrap actually works across a rollover, and
 * that append-only enforcement is a real, database-verified privilege
 * restriction — not just "we ran a REVOKE statement and assumed it worked."
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";

import { ensureOutboxSchema } from "../../src/infrastructure/postgres-outbox-schema.js";

let container: StartedPostgreSqlContainer;
let sql: Sql;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri(), { max: 5, onnotice: () => {} });
}, 120_000);

afterAll(async () => {
  await sql?.end();
  await container?.stop();
});

async function resetOutboxSchema(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS platform CASCADE`);
}

function sampleRow(occurredAt: string) {
  return {
    id: randomUUID(),
    event_name: "tenancy.member.invited",
    event_version: 1,
    occurred_at: occurredAt,
    correlation_id: randomUUID(),
    actor_type: "system",
    payload: JSON.stringify({ ok: true }),
  };
}

describe("ensureOutboxSchema (E03-T10 integration)", () => {
  beforeEach(async () => {
    await resetOutboxSchema();
  });

  it("is idempotent", async () => {
    await expect(
      ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") }),
    ).resolves.not.toThrow();
    await expect(
      ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") }),
    ).resolves.not.toThrow();
  });

  it("creates all four platform tables (outbox, checkpoints, processed_events) and both indexes", async () => {
    await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") });

    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'platform' AND table_name IN ('outbox', 'outbox_checkpoints', 'processed_events')
    `;
    expect(tables.map((t) => t.table_name).sort()).toEqual([
      "outbox",
      "outbox_checkpoints",
      "processed_events",
    ]);

    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'platform' AND tablename = 'outbox'
    `;
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining(["outbox_occurred_at_id_idx", "outbox_org_occurred_at_idx"]),
    );
  });

  it("is genuinely partitioned: current-month and next-month rows insert; a row far outside both fails", async () => {
    await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") });

    await expect(
      sql`INSERT INTO platform.outbox ${sql(sampleRow("2026-07-20T00:00:00Z"))}`,
    ).resolves.toBeDefined();
    await expect(
      sql`INSERT INTO platform.outbox ${sql(sampleRow("2026-08-05T00:00:00Z"))}`,
    ).resolves.toBeDefined();

    // No partition exists for October 2026 yet (only July + August were
    // bootstrapped) — Postgres itself rejects the insert, proving this is a
    // real partitioned table, not a plain one that would silently accept it.
    await expect(
      sql`INSERT INTO platform.outbox ${sql(sampleRow("2026-10-01T00:00:00Z"))}`,
    ).rejects.toThrow();
  });

  it("outbox_checkpoints and processed_events accept rows matching the designed shape", async () => {
    await ensureOutboxSchema(sql, { referenceDate: new Date("2026-07-15T00:00:00Z") });

    await sql`
      INSERT INTO platform.outbox_checkpoints (consumer, last_occurred_at, last_event_id, updated_at)
      VALUES ('audit', now(), ${randomUUID()}, now())
    `;
    const checkpoints = await sql`SELECT consumer FROM platform.outbox_checkpoints`;
    expect(checkpoints).toHaveLength(1);

    const eventId = randomUUID();
    await sql`
      INSERT INTO platform.processed_events (consumer, event_id, processed_at)
      VALUES ('audit', ${eventId}, now())
    `;
    // Replaying the same (consumer, event_id) violates the composite PK —
    // exactly the dedupe guarantee E02-T03/T14 build on.
    await expect(
      sql`INSERT INTO platform.processed_events (consumer, event_id, processed_at) VALUES ('audit', ${eventId}, now())`,
    ).rejects.toThrow();
  });

  it("partition bounds are correct regardless of the bootstrapping session's TimeZone", async () => {
    const reserved = await sql.reserve();
    try {
      // A bare date literal in a partition bound is parsed using the DDL
      // session's TimeZone, not UTC. Bootstrapping under a non-UTC zone
      // reproduces the bug this test guards: without the explicit +00:00
      // offset in computeMonthlyPartitionBounds, an event at the first
      // hour of the UTC month would find no covering partition.
      await reserved.unsafe(`SET TimeZone = 'America/New_York'`);
      await ensureOutboxSchema(reserved, { referenceDate: new Date("2026-07-15T00:00:00Z") });

      await expect(
        reserved`INSERT INTO platform.outbox ${reserved(sampleRow("2026-07-01T01:00:00Z"))}`,
      ).resolves.toBeDefined();
      await expect(
        reserved`INSERT INTO platform.outbox ${reserved(sampleRow("2026-07-31T23:59:59Z"))}`,
      ).resolves.toBeDefined();
    } finally {
      await reserved.unsafe(`RESET TimeZone`);
      reserved.release();
    }
  });

  it("append-only enforcement is a real, verified Postgres privilege restriction", async () => {
    await sql.unsafe(`DROP ROLE IF EXISTS it_outbox_app_role`);
    await sql.unsafe(`CREATE ROLE it_outbox_app_role`);
    try {
      await ensureOutboxSchema(sql, {
        referenceDate: new Date("2026-07-15T00:00:00Z"),
        applicationRole: "it_outbox_app_role",
      });
      // Simulate a role that otherwise has full DML — the bootstrap should
      // have revoked only UPDATE/DELETE, not SELECT/INSERT.
      await sql.unsafe(`GRANT USAGE ON SCHEMA platform TO it_outbox_app_role`);
      await sql.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON platform.outbox TO it_outbox_app_role`,
      );
      await ensureOutboxSchema(sql, {
        referenceDate: new Date("2026-07-15T00:00:00Z"),
        applicationRole: "it_outbox_app_role",
      });

      const reserved = await sql.reserve();
      try {
        await reserved.unsafe(`SET ROLE it_outbox_app_role`);

        await expect(
          reserved`INSERT INTO platform.outbox ${reserved(sampleRow("2026-07-21T00:00:00Z"))}`,
        ).resolves.toBeDefined();

        await expect(
          reserved.unsafe(`UPDATE platform.outbox SET event_version = 2`),
        ).rejects.toThrow(/permission denied/i);

        await expect(reserved.unsafe(`DELETE FROM platform.outbox`)).rejects.toThrow(
          /permission denied/i,
        );

        await reserved.unsafe(`RESET ROLE`);
      } finally {
        reserved.release();
      }
    } finally {
      await sql.unsafe(`DROP OWNED BY it_outbox_app_role`).catch(() => {});
      await sql.unsafe(`DROP ROLE IF EXISTS it_outbox_app_role`);
    }
  });
});
