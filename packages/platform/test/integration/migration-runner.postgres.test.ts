/**
 * Real-Postgres integration tests for E03-T02 (Testcontainers). Proves
 * behavior the in-memory fake cannot: actual DDL execution, transactional
 * rollback on a failing migration, and genuine cross-connection advisory-
 * lock serialization between concurrent runners.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import { isErr, isOk } from "@corestack/kernel";

import { computeChainChecksum } from "../../src/domain/chain-checksum.js";
import { parseMigrationFile } from "../../src/domain/migration-file.js";
import { runMigrations } from "../../src/application/migration-runner.js";
import {
  ensureMigrationTrackingSchema,
  PostgresMigrationRunnerStore,
} from "../../src/infrastructure/postgres-migration-runner-store.js";
import { createTestDatabase, type TestDatabase } from "../../test-support/test-database.js";

let db: TestDatabase;
let sql: Sql;

beforeAll(async () => {
  db = await createTestDatabase();
  sql = db.sql;
  await ensureMigrationTrackingSchema(sql);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function migration(module: string, version: number, description: string, body: string) {
  const filename = `${String(version).padStart(4, "0")}_${description}.sql`;
  return parseMigrationFile(
    module,
    filename,
    `-- @description: ${description}\n-- @lock-impact: none\n${body}`,
  );
}

async function resetModule(moduleName: string): Promise<void> {
  await sql`DELETE FROM platform.module_migrations WHERE module = ${moduleName}`;
}

describe("PostgresMigrationRunnerStore + runMigrations (E03-T02 integration)", () => {
  beforeEach(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS it_tenancy CASCADE`);
    await sql.unsafe(`CREATE SCHEMA it_tenancy`);
  });

  it("ensureMigrationTrackingSchema is idempotent", async () => {
    await expect(ensureMigrationTrackingSchema(sql)).resolves.not.toThrow();
    await expect(ensureMigrationTrackingSchema(sql)).resolves.not.toThrow();
  });

  it("applies real DDL and records the tracking row", async () => {
    await resetModule("it-tenancy");
    const store = new PostgresMigrationRunnerStore(sql);
    const m1 = await migration(
      "it-tenancy",
      1,
      "create-orgs",
      "CREATE TABLE it_tenancy.organizations (id uuid PRIMARY KEY);",
    );

    const result = await runMigrations({ module: "it-tenancy", migrations: [m1] }, store);
    expect(isOk(result)).toBe(true);

    const tableExists = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'it_tenancy' AND table_name = 'organizations'
      ) AS exists
    `;
    expect(tableExists[0]?.exists).toBe(true);

    const tracked = await sql`SELECT * FROM platform.module_migrations WHERE module = 'it-tenancy'`;
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.version).toBe(1);
    expect(tracked[0]?.checksum).toBe(await computeChainChecksum([m1.checksum]));
  });

  it("re-running the same migration set is a clean no-op", async () => {
    await resetModule("it-tenancy");
    const store = new PostgresMigrationRunnerStore(sql);
    const m1 = await migration(
      "it-tenancy",
      1,
      "create-orgs",
      "CREATE TABLE it_tenancy.organizations (id uuid PRIMARY KEY);",
    );

    await runMigrations({ module: "it-tenancy", migrations: [m1] }, store);
    const second = await runMigrations({ module: "it-tenancy", migrations: [m1] }, store);

    expect(isOk(second)).toBe(true);
    if (isOk(second)) expect(second.value.appliedVersions).toEqual([]);
  });

  it("a failing migration rolls back completely — no table, no tracking-row change", async () => {
    await resetModule("it-tenancy");
    const store = new PostgresMigrationRunnerStore(sql);
    const m1 = await migration(
      "it-tenancy",
      1,
      "create-orgs",
      "CREATE TABLE it_tenancy.organizations (id uuid PRIMARY KEY);",
    );
    const badM2 = await migration("it-tenancy", 2, "broken", "THIS IS NOT VALID SQL;;;");

    const first = await runMigrations({ module: "it-tenancy", migrations: [m1] }, store);
    expect(isOk(first)).toBe(true);

    await expect(
      runMigrations({ module: "it-tenancy", migrations: [m1, badM2] }, store),
    ).rejects.toThrow();

    // Version 1 remains recorded; version 2 never got applied or tracked.
    const tracked =
      await sql`SELECT version FROM platform.module_migrations WHERE module = 'it-tenancy'`;
    expect(tracked[0]?.version).toBe(1);
  });

  it("refuses drifted history against a real corrupted tracking row", async () => {
    await resetModule("it-tenancy");
    const store = new PostgresMigrationRunnerStore(sql);
    const m1 = await migration(
      "it-tenancy",
      1,
      "create-orgs",
      "CREATE TABLE it_tenancy.organizations (id uuid PRIMARY KEY);",
    );
    const m2 = await migration(
      "it-tenancy",
      2,
      "add-slug",
      "ALTER TABLE it_tenancy.organizations ADD COLUMN slug text;",
    );

    await runMigrations({ module: "it-tenancy", migrations: [m1] }, store);
    // Simulate a hand-edited migration file: corrupt the recorded checksum directly.
    await sql`UPDATE platform.module_migrations SET checksum = 'corrupted' WHERE module = 'it-tenancy'`;

    const result = await runMigrations({ module: "it-tenancy", migrations: [m1, m2] }, store);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toMatch(/drifted/);

    // m2 must never have been applied once drift was detected.
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'it_tenancy' AND table_name = 'organizations'
    `;
    expect(columns.map((c) => c.column_name)).not.toContain("slug");
  });

  it("two concurrent runners for the SAME module never double-apply (real advisory lock)", async () => {
    await resetModule("it-tenancy");
    // Two separate connection pools, simulating two separate app instances
    // booting simultaneously.
    const sqlA = postgres(db.connectionString, { max: 5, onnotice: () => {} });
    const sqlB = postgres(db.connectionString, { max: 5, onnotice: () => {} });
    const storeA = new PostgresMigrationRunnerStore(sqlA);
    const storeB = new PostgresMigrationRunnerStore(sqlB);

    const m1 = await migration(
      "it-tenancy",
      1,
      "create-orgs",
      "CREATE TABLE it_tenancy.organizations (id uuid PRIMARY KEY);",
    );

    try {
      // If the advisory lock did not serialize these, the second CREATE
      // TABLE would race the first and fail with "relation already
      // exists" — this test is a genuine behavioral proof, not a timing
      // assumption.
      const [resultA, resultB] = await Promise.all([
        runMigrations({ module: "it-tenancy", migrations: [m1] }, storeA),
        runMigrations({ module: "it-tenancy", migrations: [m1] }, storeB),
      ]);
      expect(isOk(resultA)).toBe(true);
      expect(isOk(resultB)).toBe(true);

      const appliedCounts = [resultA, resultB].map((r) =>
        isOk(r) ? r.value.appliedVersions.length : -1,
      );
      // Exactly one of the two actually applied migration 1; the other saw
      // it already recorded once it acquired the lock.
      expect(appliedCounts.sort()).toEqual([0, 1]);
    } finally {
      await sqlA.end();
      await sqlB.end();
    }
  });

  it("a @concurrent migration runs outside a transaction (CREATE INDEX CONCURRENTLY succeeds)", async () => {
    await resetModule("it-tenancy");
    const store = new PostgresMigrationRunnerStore(sql);
    const m1 = await migration(
      "it-tenancy",
      1,
      "create-orgs",
      "CREATE TABLE it_tenancy.organizations (id uuid PRIMARY KEY, slug text);",
    );
    // CREATE INDEX CONCURRENTLY fails outright if Postgres sees it inside a
    // transaction block ("cannot run inside a transaction block") — so this
    // succeeding is a real proof the @concurrent path skips .begin().
    const m2Source =
      "-- @description: index slug concurrently\n-- @lock-impact: brief\n-- @concurrent: true\n" +
      "CREATE INDEX CONCURRENTLY idx_org_slug ON it_tenancy.organizations (slug);";
    const m2 = await parseMigrationFile("it-tenancy", "0002_index-slug.sql", m2Source);

    const result = await runMigrations({ module: "it-tenancy", migrations: [m1, m2] }, store);
    expect(isOk(result)).toBe(true);

    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'it_tenancy' AND tablename = 'organizations'
    `;
    expect(indexes.map((i) => i.indexname)).toContain("idx_org_slug");
  });
});
