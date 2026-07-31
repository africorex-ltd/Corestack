import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";
import { parseMigrationFile } from "@corestack/platform";

/**
 * Verifies migration 0004 (E05-T15) — a single additive `GRANT`, not a
 * table/RLS migration, so this test is deliberately smaller than
 * `migration-notification-work-items-consistency.test.ts`'s (0003's own
 * RLS-DDL-generator cross-check does not apply here; there is no new RLS
 * statement in this migration to verify against a generator).
 */

const MIGRATION_PATH = fileURLToPath(
  new URL(
    "../../migrations/tenancy/0004_grant-tenancy-platform-update-notification-work-items.sql",
    import.meta.url,
  ),
);

let migrationSql: string;

beforeAll(async () => {
  const source = await readFile(MIGRATION_PATH, "utf8");
  const parsed = await parseMigrationFile(
    "tenancy",
    "0004_grant-tenancy-platform-update-notification-work-items.sql",
    source,
  );
  migrationSql = parsed.sql;
});

describe("0004_grant-tenancy-platform-update-notification-work-items.sql", () => {
  it("parses cleanly against the platform migration-file contract", async () => {
    const source = await readFile(MIGRATION_PATH, "utf8");
    const parsed = await parseMigrationFile(
      "tenancy",
      "0004_grant-tenancy-platform-update-notification-work-items.sql",
      source,
    );
    expect(parsed.version).toBe(4);
    expect(parsed.header.lockImpact).toBe("none");
  });

  it("grants exactly UPDATE (not SELECT/INSERT again, not DELETE) on notification_work_items to tenancy_platform", () => {
    expect(migrationSql).toContain(
      "GRANT UPDATE ON tenancy.notification_work_items TO tenancy_platform;",
    );
    const grantLines = migrationSql
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^GRANT\b/.test(line));
    expect(grantLines).toEqual(["GRANT UPDATE ON tenancy.notification_work_items TO tenancy_platform;"]);
  });
});
