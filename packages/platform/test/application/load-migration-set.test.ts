import { describe, expect, it } from "vitest";
import { isErr, isOk, ValidationError } from "@corestack/kernel";

import { loadMigrationSet } from "../../src/application/load-migration-set.js";
import { InMemoryMigrationSource } from "../../src/testing/in-memory-migration-source.js";

function header(description: string, lockImpact = "none"): string {
  return `-- @description: ${description}\n-- @lock-impact: ${lockImpact}\n`;
}

describe("loadMigrationSet", () => {
  it("loads and sorts a valid set by version regardless of listing order", async () => {
    const source = new InMemoryMigrationSource();
    source.addFile(
      "tenancy",
      "0002_add-slug.sql",
      header("add slug") + "ALTER TABLE t ADD slug text;",
    );
    source.addFile("tenancy", "0001_create.sql", header("create") + "CREATE TABLE t (id uuid);");

    const result = await loadMigrationSet("tenancy", source);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.migrations.map((m) => m.version)).toEqual([1, 2]);
      expect(result.value.migrations[0]?.filename).toBe("0001_create.sql");
    }
  });

  it("a module with no files yet is a valid, empty set", async () => {
    const source = new InMemoryMigrationSource();
    const result = await loadMigrationSet("auth", source);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.migrations).toEqual([]);
  });

  it("rejects a version gap", async () => {
    const source = new InMemoryMigrationSource();
    source.addFile("tenancy", "0001_create.sql", header("create") + "CREATE TABLE t (id uuid);");
    source.addFile("tenancy", "0003_skip.sql", header("skip") + "SELECT 1;");

    const result = await loadMigrationSet("tenancy", source);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.metadata.issues).toEqual([
        expect.stringMatching(/expected version 2 next but found 3/),
      ]);
    }
  });

  it("rejects a duplicate version across two files", async () => {
    const source = new InMemoryMigrationSource();
    source.addFile("tenancy", "0001_create.sql", header("create") + "CREATE TABLE t (id uuid);");
    source.addFile("tenancy", "0001_create-again.sql", header("dup") + "SELECT 1;");

    const result = await loadMigrationSet("tenancy", source);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.metadata.issues).toEqual([expect.stringMatching(/duplicate version 1/)]);
    }
  });

  it("aggregates every malformed file's error instead of stopping at the first", async () => {
    const source = new InMemoryMigrationSource();
    source.addFile("tenancy", "0001_bad-header.sql", "SELECT 1;"); // missing header entirely
    source.addFile("tenancy", "0002_bad-lock.sql", header("d", "catastrophic") + "SELECT 1;");

    const result = await loadMigrationSet("tenancy", source);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.metadata.issues).toHaveLength(2);
    }
  });

  it("does not report ordering issues when file-level parsing already failed", async () => {
    // Parse errors short-circuit before ordering validation runs — ordering
    // over an already-invalid set would be a misleading second error.
    const source = new InMemoryMigrationSource();
    source.addFile("tenancy", "0001_bad.sql", "SELECT 1;"); // no header
    source.addFile("tenancy", "0003_gap.sql", header("d") + "SELECT 1;"); // would also be a gap

    const result = await loadMigrationSet("tenancy", source);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toMatch(/invalid file/);
    }
  });
});
