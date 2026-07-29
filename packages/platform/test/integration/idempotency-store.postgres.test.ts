/**
 * Real-Postgres integration tests for E03-T43's `PostgresIdempotencyStore`
 * (kernel's `IdempotencyStore` port, added this task to fill a blueprint
 * gap — see ADR-0019). The shared `IdempotencyStore` contract suite
 * (`@corestack/kernel/testing`, E04) proves the full begin/complete/
 * replay/conflict contract — including the tenant-isolation certification
 * finding (ADR-0020: two organizations presenting the identical (scope,
 * key, requestHash) never share a lock or a replayed response) — against
 * this real adapter, no hand-mirrored duplicate needed. This file then
 * proves the blueprint's own acceptance criterion no in-memory store can:
 * "concurrent same-key second caller blocks/conflicts correctly (tested
 * with 2 connections)".
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  defineIdempotencyStoreContractSuite,
  type SuiteHarness,
} from "@corestack/kernel/testing";
import postgres, { type Sql } from "postgres";

import { ensureIdempotencyKeysSchema } from "../../src/infrastructure/postgres-idempotency-store-schema.js";
import {
  PostgresIdempotencyStore,
  pruneIdempotencyKeys,
} from "../../src/infrastructure/postgres-idempotency-store.js";
import { createTestDatabase, type TestDatabase } from "../../test-support/test-database.js";

const ORG_A = "11111111-1111-1111-1111-111111111111";

let db: TestDatabase;
let sql: Sql;

beforeAll(async () => {
  db = await createTestDatabase();
  sql = db.sql;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await sql.unsafe(`DROP SCHEMA IF EXISTS platform CASCADE`);
  await ensureIdempotencyKeysSchema(sql);
});

const harness: SuiteHarness = { describe, it, expect, beforeEach, afterEach };

// E04-T09: the same suite that proves kernel's InMemoryIdempotencyStore
// (including the ADR-0020 cross-tenant SECURITY test), proven again here
// against the real adapter — no hand-mirrored duplicate.
defineIdempotencyStoreContractSuite(harness, (clock) => new PostgresIdempotencyStore(sql, clock));

describe("PostgresIdempotencyStore (E03-T43 integration, Postgres-specific)", () => {
  it("acceptance criterion: a concurrent same-key second caller on a genuinely separate connection blocks then classifies correctly, never double-acquiring the lock", async () => {
    const connA = postgres(db.connectionString, { max: 1, onnotice: () => {} });
    const connB = postgres(db.connectionString, { max: 1, onnotice: () => {} });
    try {
      const storeA = new PostgresIdempotencyStore(connA);
      const storeB = new PostgresIdempotencyStore(connB);

      // Same requestHash on both — the loser must see inProgress, never
      // started (which would mean two callers both think they own the lock).
      const [resultA, resultB] = await Promise.all([
        storeA.begin(ORG_A, "orders", "concurrent-key", "same-hash", 60_000),
        storeB.begin(ORG_A, "orders", "concurrent-key", "same-hash", 60_000),
      ]);

      const outcomes = [resultA.outcome, resultB.outcome].sort();
      expect(outcomes).toEqual(["inProgress", "started"]);

      const rows = await sql`SELECT status FROM platform.idempotency_keys`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("in_progress");
    } finally {
      await connA.end();
      await connB.end();
    }
  });

  it("20 concurrent callers for the same (scope, key, requestHash) produce exactly one started and the rest inProgress", async () => {
    const store = new PostgresIdempotencyStore(sql);

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        store.begin(ORG_A, "orders", "race-key", "same-hash", 60_000),
      ),
    );

    const started = results.filter((r) => r.outcome === "started").length;
    const inProgress = results.filter((r) => r.outcome === "inProgress").length;
    expect(started).toBe(1);
    expect(inProgress).toBe(19);

    const rows = await sql`SELECT count(*) FROM platform.idempotency_keys`;
    expect(rows[0]?.count).toBe("1");
  });
});

describe("pruneIdempotencyKeys (E03-T43 integration)", () => {
  it("deletes only entries expired as of the given cutoff", async () => {
    await sql`
      INSERT INTO platform.idempotency_keys (scope, key, request_hash, status, expires_at) VALUES
      ('old', 'old', 'h1', 'completed', '2026-07-01T00:00:00Z'),
      ('recent', 'recent', 'h2', 'completed', '2026-07-28T00:00:00Z')
    `;

    const deleted = await pruneIdempotencyKeys(sql, new Date("2026-07-15T00:00:00Z"));
    expect(deleted).toBe(1);

    const remaining = await sql<{ key: string }[]>`SELECT key FROM platform.idempotency_keys`;
    expect(remaining.map((r) => r.key)).toEqual(["recent"]);
  });
});
