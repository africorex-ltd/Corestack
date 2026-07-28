/**
 * `platform.module_migrations` runner (E03-T02; DB design §3, §18).
 *
 * Orchestration only — pure with respect to I/O beyond the injected
 * `MigrationRunnerStore` port, so it is fully testable with an in-memory
 * fake and separately verified against real Postgres via the contract-
 * style integration tests. Contract:
 *
 * - **Applies in order**: only migrations with `version > currentVersion`
 *   run, strictly ascending (T01's loader already guarantees the input
 *   set has no gaps/duplicates).
 * - **Records checksum**: after each migration, the store persists a new
 *   chain checksum (domain layer) covering every applied migration so far.
 * - **Refuses drifted history**: before applying anything, the on-disk
 *   chain checksum for "migrations 1..currentVersion" is recomputed and
 *   compared to what's recorded; a mismatch is a hard stop with an
 *   actionable `ValidationError`, never a silent proceed.
 * - **Advisory-lock for concurrent runners**: the entire check-and-apply
 *   sequence runs inside `store.withModuleLock`, so two runner processes
 *   booting simultaneously serialize instead of racing to apply the same
 *   migrations twice.
 */

import { ValidationError, err, ok, type Result } from "@corestack/kernel";

import { computeChainChecksum } from "../domain/chain-checksum.js";
import type { MigrationFile } from "../domain/migration-file.js";
import type { MigrationSet } from "./load-migration-set.js";

export interface ModuleMigrationState {
  readonly version: number;
  readonly checksum: string;
}

export interface MigrationRunnerStore {
  /** The recorded state for a module, or `null` if it has never been migrated. */
  getState(moduleName: string): Promise<ModuleMigrationState | null>;
  /**
   * Apply one migration and persist `newState` for it. Implementations
   * should make this atomic where the migration allows (see `@concurrent`
   * in the migration header, T01) — non-concurrent migrations run inside
   * a transaction with the state update; `@concurrent: true` migrations
   * cannot use a transaction (Postgres forbids `CREATE INDEX
   * CONCURRENTLY` inside one) and accept a small, documented
   * inconsistency window between applying and recording.
   */
  applyMigration(
    moduleName: string,
    migration: MigrationFile,
    newState: ModuleMigrationState,
  ): Promise<void>;
  /** Run `fn` while holding an exclusive, module-scoped lock. */
  withModuleLock<T>(moduleName: string, fn: () => Promise<T>): Promise<T>;
}

export interface MigrationRunResult {
  readonly module: string;
  readonly previousVersion: number;
  readonly currentVersion: number;
  readonly appliedVersions: readonly number[];
}

async function detectDrift(
  migrationSet: MigrationSet,
  recorded: ModuleMigrationState,
): Promise<ValidationError | null> {
  const onDiskUpToRecorded = migrationSet.migrations.filter((m) => m.version <= recorded.version);

  if (onDiskUpToRecorded.length !== recorded.version) {
    return new ValidationError(
      `module "${migrationSet.module}" is recorded at version ${recorded.version} but only ` +
        `${onDiskUpToRecorded.length} migration file(s) up to that version exist on disk`,
      {
        metadata: {
          module: migrationSet.module,
          recordedVersion: recorded.version,
          foundOnDisk: onDiskUpToRecorded.length,
        },
      },
    );
  }

  const expected = await computeChainChecksum(onDiskUpToRecorded.map((m) => m.checksum));
  if (expected !== recorded.checksum) {
    return new ValidationError(
      `module "${migrationSet.module}" migration history has drifted: the on-disk migrations up ` +
        `to version ${recorded.version} no longer match what was recorded when they were applied — ` +
        `check for hand-edited or reordered migration files in that range`,
      { metadata: { module: migrationSet.module, recordedVersion: recorded.version } },
    );
  }

  return null;
}

export async function runMigrations(
  migrationSet: MigrationSet,
  store: MigrationRunnerStore,
): Promise<Result<MigrationRunResult, ValidationError>> {
  return store.withModuleLock(
    migrationSet.module,
    async (): Promise<Result<MigrationRunResult, ValidationError>> => {
      const recorded = await store.getState(migrationSet.module);
      const previousVersion = recorded?.version ?? 0;

      if (recorded !== null) {
        const driftError = await detectDrift(migrationSet, recorded);
        if (driftError !== null) return err(driftError);
      }

      const pending = migrationSet.migrations.filter((m) => m.version > previousVersion);
      const appliedVersions: number[] = [];
      let checksumsSoFar = migrationSet.migrations
        .filter((m) => m.version <= previousVersion)
        .map((m) => m.checksum);

      for (const migration of pending) {
        checksumsSoFar = [...checksumsSoFar, migration.checksum];
        const newChecksum = await computeChainChecksum(checksumsSoFar);
        await store.applyMigration(migrationSet.module, migration, {
          version: migration.version,
          checksum: newChecksum,
        });
        appliedVersions.push(migration.version);
      }

      return ok({
        module: migrationSet.module,
        previousVersion,
        currentVersion: previousVersion + pending.length,
        appliedVersions,
      });
    },
  );
}
