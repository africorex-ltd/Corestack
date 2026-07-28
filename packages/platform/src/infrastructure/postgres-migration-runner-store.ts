/**
 * `PostgresMigrationRunnerStore` — the reference `MigrationRunnerStore`
 * adapter (E03-T02; DB design §3, §18). Ships under the `./postgres`
 * subpath (ADR-0010) so the pure/in-memory parts of `@corestack/platform`
 * never force a Postgres driver on adopters who don't need it.
 *
 * Operational requirement: the injected `Sql` pool must allow **at least
 * two concurrent connections** — one held by the advisory lock for the
 * duration of a module's migration run, one (or more) used by the
 * transactions that actually apply migrations. A pool of size 1 would
 * deadlock (the lock-holding connection would never free the slot the
 * migration transaction needs).
 */

import type { Sql } from "postgres";

import { computeAdvisoryLockKey } from "../domain/chain-checksum.js";
import { assertValidModuleName, type MigrationFile } from "../domain/migration-file.js";
import type {
  MigrationRunnerStore,
  ModuleMigrationState,
} from "../application/migration-runner.js";
import { ensurePlatformSchema } from "./ensure-platform-schema.js";

/**
 * Idempotently creates the `platform` schema and `platform.module_migrations`
 * tracking table (DB design §3's exact shape: one row per module). Call once
 * at boot before running any module's migrations — this bootstrap is
 * deliberately *not* tracked by the runner itself (there is no meta-migration
 * for the tracking table; every migration tool bootstraps its own ledger the
 * same way, avoiding a chicken-and-egg dependency on itself).
 */
export async function ensureMigrationTrackingSchema(sql: Sql): Promise<void> {
  await ensurePlatformSchema(sql);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS platform.module_migrations (
      module text PRIMARY KEY,
      version integer NOT NULL,
      applied_at timestamptz NOT NULL,
      checksum text NOT NULL
    )
  `);
}

export class PostgresMigrationRunnerStore implements MigrationRunnerStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async getState(moduleName: string): Promise<ModuleMigrationState | null> {
    assertValidModuleName(moduleName);
    const rows = await this.#sql<{ version: number; checksum: string }[]>`
      SELECT version, checksum FROM platform.module_migrations WHERE module = ${moduleName}
    `;
    const row = rows[0];
    return row === undefined ? null : { version: row.version, checksum: row.checksum };
  }

  async applyMigration(
    moduleName: string,
    migration: MigrationFile,
    newState: ModuleMigrationState,
  ): Promise<void> {
    assertValidModuleName(moduleName);

    if (migration.header.concurrent) {
      // CREATE INDEX CONCURRENTLY (and similar) cannot run inside a
      // transaction block — apply in autocommit mode, then record state as
      // a separate step. A crash between these two steps leaves a small,
      // documented inconsistency window; unavoidable for @concurrent
      // migrations with any migration tool, not specific to this one.
      await this.#sql.unsafe(migration.sql);
      await this.#sql`
        INSERT INTO platform.module_migrations (module, version, applied_at, checksum)
        VALUES (${moduleName}, ${newState.version}, now(), ${newState.checksum})
        ON CONFLICT (module) DO UPDATE SET
          version = EXCLUDED.version,
          applied_at = EXCLUDED.applied_at,
          checksum = EXCLUDED.checksum
      `;
      return;
    }

    // Transactional path: the migration and the tracking-row update commit
    // or roll back together — inlined here (rather than shared with the
    // @concurrent path above) because `tx` inside `.begin()` is a
    // `TransactionSql`, a distinct type from the pool's `Sql` that doesn't
    // share a common query-callable supertype worth fighting the library's
    // types over for two lines of duplicated SQL.
    await this.#sql.begin(async (tx) => {
      await tx.unsafe(migration.sql);
      await tx`
        INSERT INTO platform.module_migrations (module, version, applied_at, checksum)
        VALUES (${moduleName}, ${newState.version}, now(), ${newState.checksum})
        ON CONFLICT (module) DO UPDATE SET
          version = EXCLUDED.version,
          applied_at = EXCLUDED.applied_at,
          checksum = EXCLUDED.checksum
      `;
    });
  }

  async withModuleLock<T>(moduleName: string, fn: () => Promise<T>): Promise<T> {
    assertValidModuleName(moduleName);
    // Postgres advisory-lock functions take bigint; postgres.js's tagged
    // template doesn't accept a JS `bigint` parameter directly, and the key
    // can exceed Number.MAX_SAFE_INTEGER, so it's passed as text and cast
    // explicitly rather than narrowed through `Number(...)`.
    const lockKey = (await computeAdvisoryLockKey(moduleName)).toString();

    // Session-scoped lock: reserve one dedicated connection so the lock
    // persists across every migration transaction run inside fn(), then
    // explicitly unlock and release even if fn() throws.
    const reserved = await this.#sql.reserve();
    try {
      await reserved`SELECT pg_advisory_lock(${lockKey}::bigint)`;
      try {
        return await fn();
      } finally {
        await reserved`SELECT pg_advisory_unlock(${lockKey}::bigint)`;
      }
    } finally {
      reserved.release();
    }
  }
}
