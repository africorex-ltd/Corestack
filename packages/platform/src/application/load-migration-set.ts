/**
 * `loadMigrationSet` — the migration loader use case (E03-T01).
 *
 * Loads every migration file for one module from a `MigrationSource`,
 * validates each file's header/body (domain layer), validates the *set's*
 * ordering (strictly sequential versions starting at 1 — a gap or
 * duplicate is treated as an authoring mistake, not a valid sparse
 * sequence: it is far more often a deleted/renumbered file than an
 * intentional skip, and refusing it loudly is cheaper than debugging a
 * silently-wrong migration order later), and returns the fully-checked,
 * version-sorted set.
 *
 * Errors are **aggregated, not fail-fast** (matching the config-validation
 * convention arriving in T22): every malformed file and every ordering
 * problem is collected and reported together, so a module author fixes
 * everything in one pass instead of one compile-error-style loop.
 *
 * This is an *expected* failure path (bad migration authoring is a normal,
 * recoverable mistake a CLI should report clearly) — hence `Result`, not a
 * thrown exception. Concurrency: this function is pure orchestration over
 * its inputs with no shared mutable state; calling it concurrently for
 * different modules, or the same module, is always safe.
 */

import { err, ok, ValidationError, type Result } from "@corestack/kernel";

import { parseMigrationFile, type MigrationFile } from "../domain/migration-file.js";
import type { MigrationSource } from "./migration-source.js";

export interface MigrationSet {
  readonly module: string;
  /** Sorted ascending by version; version 1..N with no gaps or duplicates. */
  readonly migrations: readonly MigrationFile[];
}

function validateOrdering(moduleName: string, migrations: readonly MigrationFile[]): string[] {
  const issues: string[] = [];
  const firstFilenameByVersion = new Map<number, string>();

  for (const migration of migrations) {
    const existing = firstFilenameByVersion.get(migration.version);
    if (existing !== undefined) {
      issues.push(
        `duplicate version ${migration.version} in module "${moduleName}": "${existing}" and "${migration.filename}"`,
      );
    } else {
      firstFilenameByVersion.set(migration.version, migration.filename);
    }
  }

  const versions = [...firstFilenameByVersion.keys()].sort((a, b) => a - b);
  for (let i = 0; i < versions.length; i++) {
    const expected = i + 1;
    if (versions[i] !== expected) {
      issues.push(
        `module "${moduleName}" expected version ${expected} next but found ${versions[i]} — ` +
          `versions must be sequential starting at 1 with no gaps`,
      );
      break; // one gap message is enough; further indices would cascade misleadingly
    }
  }

  return issues;
}

export async function loadMigrationSet(
  moduleName: string,
  source: MigrationSource,
): Promise<Result<MigrationSet, ValidationError>> {
  const rawFiles = await source.listMigrationFiles(moduleName);

  const parseIssues: string[] = [];
  const parsed: MigrationFile[] = [];

  for (const file of rawFiles) {
    try {
      parsed.push(await parseMigrationFile(moduleName, file.filename, file.content));
    } catch (error) {
      parseIssues.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (parseIssues.length > 0) {
    return err(
      new ValidationError(
        `migration set "${moduleName}" has ${parseIssues.length} invalid file(s)`,
        {
          metadata: { module: moduleName, issues: parseIssues },
        },
      ),
    );
  }

  const sorted = [...parsed].sort((a, b) => a.version - b.version);
  const orderIssues = validateOrdering(moduleName, sorted);
  if (orderIssues.length > 0) {
    return err(
      new ValidationError(`migration set "${moduleName}" has ordering problems`, {
        metadata: { module: moduleName, issues: orderIssues },
      }),
    );
  }

  return ok({ module: moduleName, migrations: sorted });
}
