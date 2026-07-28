import { describe, expect, it } from "vitest";
import { isErr, isOk, ValidationError } from "@corestack/kernel";

import { computeChainChecksum } from "../../src/domain/chain-checksum.js";
import { parseMigrationFile, type MigrationFile } from "../../src/domain/migration-file.js";
import { runMigrations } from "../../src/application/migration-runner.js";
import { InMemoryMigrationRunnerStore } from "../../src/testing/in-memory-migration-runner-store.js";

async function fixtureMigration(version: number, description: string): Promise<MigrationFile> {
  const filename = `${String(version).padStart(4, "0")}_${description}.sql`;
  const source = `-- @description: ${description}\n-- @lock-impact: none\nSELECT ${version};`;
  return parseMigrationFile("tenancy", filename, source);
}

describe("runMigrations (E03-T02)", () => {
  it("applies every migration in order for a fresh (never-migrated) module", async () => {
    const store = new InMemoryMigrationRunnerStore();
    const migrations = [await fixtureMigration(1, "create"), await fixtureMigration(2, "add-slug")];

    const result = await runMigrations({ module: "tenancy", migrations }, store);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({
        module: "tenancy",
        previousVersion: 0,
        currentVersion: 2,
        appliedVersions: [1, 2],
      });
    }
    expect(store.appliedLog).toEqual([
      { module: "tenancy", version: 1 },
      { module: "tenancy", version: 2 },
    ]);
  });

  it("applies only the migrations beyond the recorded version", async () => {
    const store = new InMemoryMigrationRunnerStore();
    const m1 = await fixtureMigration(1, "create");
    const m2 = await fixtureMigration(2, "add-slug");
    const m3 = await fixtureMigration(3, "add-index");
    store.seedState("tenancy", { version: 1, checksum: await computeChainChecksum([m1.checksum]) });

    const result = await runMigrations({ module: "tenancy", migrations: [m1, m2, m3] }, store);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({
        module: "tenancy",
        previousVersion: 1,
        currentVersion: 3,
        appliedVersions: [2, 3],
      });
    }
    expect(store.appliedLog.map((a) => a.version)).toEqual([2, 3]);
  });

  it("is a no-op when already fully up to date", async () => {
    const store = new InMemoryMigrationRunnerStore();
    const m1 = await fixtureMigration(1, "create");
    store.seedState("tenancy", { version: 1, checksum: await computeChainChecksum([m1.checksum]) });

    const result = await runMigrations({ module: "tenancy", migrations: [m1] }, store);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.appliedVersions).toEqual([]);
      expect(result.value.previousVersion).toBe(1);
      expect(result.value.currentVersion).toBe(1);
    }
    expect(store.appliedLog).toEqual([]);
  });

  it("refuses drifted history (checksum mismatch) with an actionable error, applying nothing", async () => {
    const store = new InMemoryMigrationRunnerStore();
    const m1 = await fixtureMigration(1, "create");
    const m2 = await fixtureMigration(2, "add-slug");
    // Seed a checksum that does NOT match m1's actual on-disk checksum —
    // simulates the migration file having been hand-edited after it was applied.
    store.seedState("tenancy", { version: 1, checksum: "0".repeat(64) });

    const result = await runMigrations({ module: "tenancy", migrations: [m1, m2] }, store);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toMatch(/drifted/);
      expect(result.error.metadata.module).toBe("tenancy");
      expect(result.error.metadata.recordedVersion).toBe(1);
    }
    expect(store.appliedLog).toEqual([]); // nothing applied once drift is detected
  });

  it("refuses when fewer on-disk migrations exist than the recorded version implies", async () => {
    const store = new InMemoryMigrationRunnerStore();
    const m1 = await fixtureMigration(1, "create");
    // Recorded as version 2, but only migration 1 exists on disk — e.g. a
    // deleted migration file.
    store.seedState("tenancy", { version: 2, checksum: "irrelevant" });

    const result = await runMigrations({ module: "tenancy", migrations: [m1] }, store);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toMatch(/only 1 migration file\(s\)/);
      expect(result.error.metadata.foundOnDisk).toBe(1);
    }
  });

  it("chain checksums accumulate: recorded checksum after N migrations covers all N, not just the last", async () => {
    const store = new InMemoryMigrationRunnerStore();
    const m1 = await fixtureMigration(1, "create");
    const m2 = await fixtureMigration(2, "add-slug");

    await runMigrations({ module: "tenancy", migrations: [m1, m2] }, store);
    const state = await store.getState("tenancy");
    const expected = await computeChainChecksum([m1.checksum, m2.checksum]);
    expect(state?.checksum).toBe(expected);
  });

  it("serializes concurrent runs for the SAME module via the advisory lock", async () => {
    const store = new InMemoryMigrationRunnerStore();
    const m1 = await fixtureMigration(1, "create");
    const events: string[] = [];
    const originalApply = store.applyMigration.bind(store);
    store.applyMigration = async (moduleName, migration, newState) => {
      events.push(`${moduleName}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await originalApply(moduleName, migration, newState);
      events.push(`${moduleName}:end`);
    };

    await Promise.all([
      runMigrations({ module: "tenancy", migrations: [m1] }, store),
      runMigrations({ module: "tenancy", migrations: [m1] }, store),
    ]);

    // The second run's getState (after the first completes) sees version 1
    // already recorded, so it applies nothing — exactly one apply happens,
    // proving the two runs did not race each other.
    expect(events).toEqual(["tenancy:start", "tenancy:end"]);
  });

  it("does not serialize runs for DIFFERENT modules", async () => {
    const store = new InMemoryMigrationRunnerStore();
    const tenancyM1 = await fixtureMigration(1, "create");
    const authM1 = await parseMigrationFile(
      "auth",
      "0001_create.sql",
      "-- @description: create\n-- @lock-impact: none\nSELECT 1;",
    );

    const [tenancyResult, authResult] = await Promise.all([
      runMigrations({ module: "tenancy", migrations: [tenancyM1] }, store),
      runMigrations({ module: "auth", migrations: [authM1] }, store),
    ]);
    expect(isOk(tenancyResult) && isOk(authResult)).toBe(true);
    expect(store.appliedLog.map((a) => a.module).sort()).toEqual(["auth", "tenancy"]);
  });
});
