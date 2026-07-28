/**
 * `FsMigrationSource` — the reference `MigrationSource` adapter (E03-T01).
 *
 * Reads `<baseDir>/<moduleName>/*.sql`. Module names are validated
 * (`assertValidModuleName`, domain layer) *before* any path is built, so a
 * crafted module name can never traverse outside `baseDir` — the guard is
 * structural, not a runtime string check on the resulting path.
 *
 * Failure modes: a missing module directory returns an empty file list
 * (a brand-new module simply has no migrations yet — not an error);
 * any other filesystem error (permission denied, I/O error) rejects.
 * Non-`.sql` entries in the directory are ignored.
 *
 * Retry/timeout/cancellation: none — local filesystem reads of small SQL
 * files are not subject to network partition and are expected to complete
 * in low single-digit milliseconds; adding retry/timeout machinery here
 * would be complexity with no corresponding failure mode to justify it.
 * Concurrency: read-only, holds no state across calls — safe to call
 * concurrently for the same or different modules.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { assertValidModuleName } from "../domain/migration-file.js";
import type { MigrationSource, RawMigrationFile } from "../application/migration-source.js";

export interface FsMigrationSourceOptions {
  /** Directory containing one subdirectory per module. */
  readonly baseDir: string;
}

export class FsMigrationSource implements MigrationSource {
  readonly #baseDir: string;

  constructor(options: FsMigrationSourceOptions) {
    this.#baseDir = options.baseDir;
  }

  async listMigrationFiles(moduleName: string): Promise<RawMigrationFile[]> {
    assertValidModuleName(moduleName);
    const dir = join(this.#baseDir, moduleName);

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const sqlFilenames = entries.filter((name) => name.endsWith(".sql"));
    return Promise.all(
      sqlFilenames.map(async (filename) => ({
        filename,
        content: await readFile(join(dir, filename), "utf8"),
      })),
    );
  }
}
