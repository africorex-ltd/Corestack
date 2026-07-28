/**
 * In-memory `MigrationRunnerStore` test double (E03-T02). Lets
 * `runMigrations`'s orchestration logic (ordering, drift detection,
 * locking discipline) be tested without a real database. The advisory
 * lock is simulated with an in-process mutex — sufficient to prove the
 * *orchestration* serializes correctly; real cross-process locking is
 * verified against Postgres in the integration suite.
 */

import type {
  MigrationRunnerStore,
  ModuleMigrationState,
} from "../application/migration-runner.js";
import type { MigrationFile } from "../domain/migration-file.js";

export class InMemoryMigrationRunnerStore implements MigrationRunnerStore {
  readonly #states = new Map<string, ModuleMigrationState>();
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly appliedLog: Array<{ module: string; version: number }> = [];

  /** Seed a pre-existing recorded state, e.g. to simulate drift scenarios. */
  seedState(moduleName: string, state: ModuleMigrationState): void {
    this.#states.set(moduleName, state);
  }

  async getState(moduleName: string): Promise<ModuleMigrationState | null> {
    return this.#states.get(moduleName) ?? null;
  }

  async applyMigration(
    moduleName: string,
    migration: MigrationFile,
    newState: ModuleMigrationState,
  ): Promise<void> {
    this.appliedLog.push({ module: moduleName, version: migration.version });
    this.#states.set(moduleName, newState);
  }

  async withModuleLock<T>(moduleName: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(moduleName) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    // Swallow rejection in the chained tracker only (not in `run` itself) so
    // one failed run doesn't permanently wedge the lock for this module.
    this.#locks.set(
      moduleName,
      run.catch(() => undefined),
    );
    return run;
  }
}
