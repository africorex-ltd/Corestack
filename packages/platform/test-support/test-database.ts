/**
 * Dual-mode Postgres bootstrap for integration tests and benchmarks
 * (Infrastructure Consolidation, PostgreSQL 18 migration). Every
 * integration test file and bench script previously duplicated its own
 * `PostgreSqlContainer` boilerplate; this module gives them one shared
 * entry point that transparently targets either:
 *
 * - **Local mode** (`DATABASE_URL` env var set): connects to the given
 *   Postgres instance as an admin, creates a throwaway scratch database
 *   per call (`corestack_test_<random>`), and drops it on `close()`. This
 *   is the current local-development mode, verified against a local
 *   PostgreSQL 18.4 instance (see
 *   docs/platform/postgres-18-compatibility.md).
 * - **Testcontainers mode** (`DATABASE_URL` unset): starts a fresh
 *   `postgres:16-alpine` container per call, exactly as every test file
 *   did before — the intended future CI mode, unchanged in behavior.
 *
 * **Isolation strategy, and why a schema rename was rejected:** every
 * shipped component hardcodes the schema name `platform` (per the
 * approved Database design docs — this is a contract, not an
 * implementation detail, and reconciliation authority does not license
 * redesigning it for test convenience). Testcontainers achieved isolation
 * between parallel test files by giving each one its own throwaway
 * *container*. Local mode reproduces the same isolation by giving each
 * call its own throwaway *database* on the one shared Postgres instance
 * instead — `platform.*` inside that scratch database is still exactly
 * `platform.*`, unchanged, so every test file's existing
 * `DROP SCHEMA IF EXISTS platform CASCADE` / `ensureOutboxSchema(...)`
 * pattern works identically in both modes without modification.
 */
import { randomUUID } from "node:crypto";

import postgres, { type Sql } from "postgres";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

import { assertSafeSqlIdentifier } from "../src/domain/sql-identifier.js";

export interface TestDatabase {
  readonly sql: Sql;
  /** A fresh connection string to the same scratch database — for tests that need a second, independent connection pool (e.g. simulating two app instances). */
  readonly connectionString: string;
  close(): Promise<void>;
}

function withDatabaseName(adminUrl: string, databaseName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createLocalTestDatabase(adminUrl: string): Promise<TestDatabase> {
  const databaseName = `corestack_test_${randomUUID().replace(/-/g, "")}`;
  assertSafeSqlIdentifier(databaseName, "scratch test database name");

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const connectionString = withDatabaseName(adminUrl, databaseName);
  let sql: Sql | undefined;
  try {
    await admin.unsafe(`CREATE DATABASE ${databaseName}`);
    sql = postgres(connectionString, { max: 5, onnotice: () => {} });
  } catch (error) {
    await admin.end();
    throw error;
  }

  return {
    sql,
    connectionString,
    async close() {
      try {
        await sql.end({ timeout: 5 });
      } finally {
        try {
          // WITH (FORCE) (PG13+) reclaims the database even if a
          // connection from this process is still draining — verified
          // against PostgreSQL 18.4.
          await admin.unsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
        } finally {
          await admin.end();
        }
      }
    },
  };
}

async function createTestcontainersDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:16-alpine",
  ).start();
  const connectionString = container.getConnectionUri();
  const sql = postgres(connectionString, { max: 5, onnotice: () => {} });

  return {
    sql,
    connectionString,
    async close() {
      try {
        await sql.end({ timeout: 5 });
      } finally {
        await container.stop();
      }
    },
  };
}

/**
 * Boots a fresh, isolated Postgres target for one test file or benchmark
 * run. Call once in `beforeAll`, and `close()` in `afterAll`. Orphaned
 * scratch databases (only possible if a process crashes mid-run, since
 * `close()` runs in a `finally`) can be found with:
 * `SELECT datname FROM pg_database WHERE datname LIKE 'corestack_test_%'`.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const databaseUrl = process.env.DATABASE_URL;
  return databaseUrl === undefined
    ? createTestcontainersDatabase()
    : createLocalTestDatabase(databaseUrl);
}
