import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";
import { parseMigrationFile } from "@corestack/platform";

import { buildOrgScopedTableRlsDdl } from "../../src/infrastructure/postgres/rls/org-scoped-table-policies.js";
import { buildOrganizationsRlsDdl } from "../../src/infrastructure/postgres/rls/organizations-policies.js";
import { TENANCY_APP_ROLE, TENANCY_PLATFORM_ROLE } from "../../src/infrastructure/postgres/rls/roles.js";

/**
 * Ties the shipped SQL migration (E05-T10 Section 8) back to the tested
 * DDL generators (Section 9), the same way `examples/acme-crm-module`'s
 * migration comment claims its RLS statements are "exactly what
 * buildTenantIsolationDdl() generates" — except here that claim is
 * checked, not just asserted in a comment. No live database: this reads
 * the migration file from disk and validates it against the platform's
 * real migration-file contract, then cross-references its text against
 * the generator functions' own output.
 */

const MIGRATION_PATH = fileURLToPath(
  new URL("../../migrations/tenancy/0002_create-tenancy-tables.sql", import.meta.url),
);

const base = { schema: "tenancy", appRole: TENANCY_APP_ROLE, platformRole: TENANCY_PLATFORM_ROLE };

let migrationSql: string;

beforeAll(async () => {
  const source = await readFile(MIGRATION_PATH, "utf8");
  const parsed = await parseMigrationFile("tenancy", "0002_create-tenancy-tables.sql", source);
  migrationSql = parsed.sql;
});

describe("0002_create-tenancy-tables.sql", () => {
  it("parses cleanly against the platform migration-file contract", async () => {
    const source = await readFile(MIGRATION_PATH, "utf8");
    const parsed = await parseMigrationFile("tenancy", "0002_create-tenancy-tables.sql", source);
    expect(parsed.version).toBe(2);
    expect(parsed.header.lockImpact).toBe("none");
  });

  it("creates all three tables", () => {
    expect(migrationSql).toContain("CREATE TABLE tenancy.organizations");
    expect(migrationSql).toContain("CREATE TABLE tenancy.memberships");
    expect(migrationSql).toContain("CREATE TABLE tenancy.invitations");
  });

  it.each(["organizations", "memberships", "invitations"] as const)(
    "contains every RLS statement %s's generator produces",
    (table) => {
      const ddl =
        table === "organizations"
          ? buildOrganizationsRlsDdl({ ...base, table })
          : buildOrgScopedTableRlsDdl({ ...base, table });

      for (const statement of ddl) {
        // The migration re-indents multi-line CREATE POLICY statements
        // for readability; compare whitespace-normalized text so that
        // formatting differences don't mask a real drift.
        const normalized = statement.replace(/\s+/g, " ").trim();
        expect(migrationSql.replace(/\s+/g, " ")).toContain(normalized);
      }
    },
  );

  it("never grants DELETE to tenancy_app on any of the three tables", () => {
    const grantLines = migrationSql
      .split("\n")
      .filter((line) => /^GRANT\b/.test(line.trim()) && line.includes("tenancy_app"));
    expect(grantLines.length).toBeGreaterThan(0);
    for (const line of grantLines) {
      expect(line).not.toMatch(/\bDELETE\b/);
    }
  });

  it("grants only SELECT to tenancy_platform on each of the three tables (USAGE on the schema aside)", () => {
    const tableGrantLines = migrationSql
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^GRANT .+ ON tenancy\.\w+ TO tenancy_platform;$/.test(line));
    expect(tableGrantLines.length).toBe(3);
    for (const line of tableGrantLines) {
      expect(line).toMatch(/^GRANT SELECT ON /);
    }
  });
});
