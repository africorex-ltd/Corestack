import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "@corestack/kernel";

import { FsMigrationSource } from "../../src/infrastructure/fs-migration-source.js";

describe("FsMigrationSource", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "corestack-migrations-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("reads .sql files from <baseDir>/<module>/", async () => {
    const moduleDir = join(baseDir, "tenancy");
    await mkdir(moduleDir);
    await writeFile(
      join(moduleDir, "0001_create.sql"),
      "-- @description: d\n-- @lock-impact: none\nSELECT 1;",
    );

    const files = await new FsMigrationSource({ baseDir }).listMigrationFiles("tenancy");
    expect(files).toHaveLength(1);
    expect(files[0]?.filename).toBe("0001_create.sql");
    expect(files[0]?.content).toContain("SELECT 1;");
  });

  it("ignores non-.sql files in the module directory", async () => {
    const moduleDir = join(baseDir, "tenancy");
    await mkdir(moduleDir);
    await writeFile(
      join(moduleDir, "0001_create.sql"),
      "-- @description: d\n-- @lock-impact: none\nSELECT 1;",
    );
    await writeFile(join(moduleDir, "README.md"), "# notes");

    const files = await new FsMigrationSource({ baseDir }).listMigrationFiles("tenancy");
    expect(files.map((f) => f.filename)).toEqual(["0001_create.sql"]);
  });

  it("returns an empty array for a module with no directory yet (not an error)", async () => {
    const files = await new FsMigrationSource({ baseDir }).listMigrationFiles("brand-new");
    expect(files).toEqual([]);
  });

  it("rejects an invalid module name before touching the filesystem", async () => {
    await expect(new FsMigrationSource({ baseDir }).listMigrationFiles("../etc")).rejects.toThrow(
      ValidationError,
    );
  });
});
