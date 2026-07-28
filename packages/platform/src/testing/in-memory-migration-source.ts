/**
 * In-memory `MigrationSource` test double (E03-T01). Lets application-layer
 * tests exercise `loadMigrationSet`'s ordering/aggregation logic without
 * touching a filesystem — the same fakes-not-mocks discipline as the
 * kernel's in-memory port implementations.
 */

import type { MigrationSource, RawMigrationFile } from "../application/migration-source.js";

export class InMemoryMigrationSource implements MigrationSource {
  readonly #filesByModule = new Map<string, RawMigrationFile[]>();

  addFile(moduleName: string, filename: string, content: string): void {
    const existing = this.#filesByModule.get(moduleName) ?? [];
    existing.push({ filename, content });
    this.#filesByModule.set(moduleName, existing);
  }

  async listMigrationFiles(moduleName: string): Promise<RawMigrationFile[]> {
    return [...(this.#filesByModule.get(moduleName) ?? [])];
  }
}
