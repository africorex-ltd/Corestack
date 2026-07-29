/**
 * Real-Postgres integration tests for E03-T43's `PostgresIdempotencyStore`
 * (kernel's `IdempotencyStore` port, added this task to fill a blueprint
 * gap — see ADR-0019). Mirrors the exact begin/complete/replay/conflict
 * contract already proven in-memory
 * (`packages/kernel/test/ports.test.ts`), then proves the blueprint's own
 * acceptance criterion: "concurrent same-key second caller blocks/conflicts
 * correctly (tested with 2 connections)". Also proves the tenant-isolation
 * certification finding (ADR-0020): two organizations presenting the
 * identical `(scope, key, requestHash)` never share a lock or a replayed
 * response, against the real Postgres adapter, not just the in-memory one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "@corestack/kernel";
import postgres, { type Sql } from "postgres";

import { ensureIdempotencyKeysSchema } from "../../src/infrastructure/postgres-idempotency-store-schema.js";
import {
  PostgresIdempotencyStore,
  pruneIdempotencyKeys,
} from "../../src/infrastructure/postgres-idempotency-store.js";
import { createTestDatabase, type TestDatabase } from "../../test-support/test-database.js";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

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

describe("PostgresIdempotencyStore (E03-T43 integration)", () => {
  it("starts fresh, then completes and replays with the same body", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00.000Z"));
    const store = new PostgresIdempotencyStore(sql, clock);

    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
      outcome: "started",
    });
    await store.complete(
      ORG_A,
      "orders",
      "k1",
      "hash-a",
      { orderId: "o1", nested: { a: 1 } },
      60_000,
    );

    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
      outcome: "replay",
      response: { orderId: "o1", nested: { a: 1 } },
    });
  });

  it("the same key with a different body is a conflict", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00.000Z"));
    const store = new PostgresIdempotencyStore(sql, clock);

    await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-b", 60_000)).toEqual({
      outcome: "conflict",
    });

    await store.complete(ORG_A, "orders", "k1", "hash-a", { orderId: "o1" }, 60_000);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-b", 60_000)).toEqual({
      outcome: "conflict",
    });
  });

  it("SECURITY: two organizations presenting the identical (scope, key, requestHash) never share a lock or a replayed response", async () => {
    const store = new PostgresIdempotencyStore(sql);

    expect(
      await store.begin(ORG_A, "orders:create", "same-client-key", "same-body-hash", 60_000),
    ).toEqual({ outcome: "started" });
    await store.complete(
      ORG_A,
      "orders:create",
      "same-client-key",
      "same-body-hash",
      { orderId: "org-a-secret-order" },
      60_000,
    );

    // Org B must get its own fresh lock for the identical (scope, key,
    // requestHash) — never Org A's stored response.
    expect(
      await store.begin(ORG_B, "orders:create", "same-client-key", "same-body-hash", 60_000),
    ).toEqual({ outcome: "started" });

    // Org A's own replay must be unaffected.
    expect(
      await store.begin(ORG_A, "orders:create", "same-client-key", "same-body-hash", 60_000),
    ).toEqual({ outcome: "replay", response: { orderId: "org-a-secret-order" } });

    // Exactly two physical rows exist — one per organization, not one shared row.
    const rows = await sql`SELECT scope FROM platform.idempotency_keys`;
    expect(rows).toHaveLength(2);
  });

  it("an expired in_progress lock is reclaimable — recovers a crashed caller's key", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00.000Z"));
    const store = new PostgresIdempotencyStore(sql, clock);

    await store.begin(ORG_A, "orders", "k1", "hash-a", 1000); // caller "crashes", never completes
    clock.advance(999);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 1000)).toEqual({
      outcome: "inProgress",
    });

    clock.advance(1);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 1000)).toEqual({
      outcome: "started",
    });
  });

  it("an expired completed entry is no longer replayable — starts fresh", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00.000Z"));
    const store = new PostgresIdempotencyStore(sql, clock);

    await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000);
    await store.complete(ORG_A, "orders", "k1", "hash-a", { orderId: "o1" }, 1000);

    clock.advance(1001);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
      outcome: "started",
    });
  });

  it("complete() is a no-op once the lock has expired and been reclaimed by a newer attempt", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00.000Z"));
    const store = new PostgresIdempotencyStore(sql, clock);

    await store.begin(ORG_A, "orders", "k1", "hash-a", 1000); // attempt #1
    clock.advance(1001); // attempt #1's lock expires, unreclaimed
    await store.begin(ORG_A, "orders", "k1", "hash-b", 60_000); // attempt #2 reclaims with a new body

    await store.complete(ORG_A, "orders", "k1", "hash-a", { stale: true }, 60_000); // attempt #1's stale complete
    expect(await store.begin(ORG_A, "orders", "k1", "hash-b", 60_000)).toEqual({
      outcome: "inProgress",
    });
  });

  it("scopes are independent — the same key in a different scope starts fresh", async () => {
    const store = new PostgresIdempotencyStore(sql);
    await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000);
    expect(await store.begin(ORG_A, "refunds", "k1", "hash-a", 60_000)).toEqual({
      outcome: "started",
    });
  });

  it("null organizationId (platform-scoped) is independent from any real organization", async () => {
    const store = new PostgresIdempotencyStore(sql);
    await store.begin(null, "orders", "k1", "hash-a", 60_000);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
      outcome: "started",
    });
  });

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
