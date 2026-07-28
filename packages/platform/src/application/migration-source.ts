/**
 * `MigrationSource` port (E03-T01).
 *
 * The seam between "where migration files live" and "how they're loaded and
 * validated" — the same swap-anything discipline as every other CoreStack
 * port (Architecture §3). The filesystem is the reference adapter
 * (`FsMigrationSource`, infrastructure layer); tests supply an in-memory
 * implementation with no disk I/O.
 *
 * Contract:
 * - Returns raw, unparsed file contents for one module — ordering of the
 *   returned array is NOT significant; `loadMigrationSet` sorts by the
 *   parsed version.
 * - A module with no migrations yet returns an empty array — not an error.
 * - Non-`.sql` files in a module's directory are silently ignored by
 *   implementations (documentation, generated artifacts, etc. may coexist).
 * - Failure modes: implementations may reject the returned promise for
 *   genuine I/O failures (permission denied, disk error); a *missing*
 *   module directory is not a failure (treated as zero migrations).
 * - No retry/timeout/cancellation is specified at the port level — those
 *   are transport-specific (a network-backed source would need them; the
 *   reference filesystem adapter does not, since local disk reads are not
 *   subject to network partition and complete in single-digit milliseconds
 *   for realistic migration-set sizes).
 */

export interface RawMigrationFile {
  readonly filename: string;
  readonly content: string;
}

export interface MigrationSource {
  listMigrationFiles(moduleName: string): Promise<RawMigrationFile[]>;
}
