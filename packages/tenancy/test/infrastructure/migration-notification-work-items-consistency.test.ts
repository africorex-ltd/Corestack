import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";
import { parseMigrationFile } from "@corestack/platform";

import { buildOrgScopedTableRlsDdl } from "../../src/infrastructure/postgres/rls/org-scoped-table-policies.js";
import { TENANCY_APP_ROLE, TENANCY_PLATFORM_ROLE } from "../../src/infrastructure/postgres/rls/roles.js";

/**
 * Same discipline as migration-rls-consistency.test.ts (E05-T10), applied
 * to the new notification_work_items table (E05-T14): the shipped
 * migration's RLS statements are checked against the same
 * buildOrgScopedTableRlsDdl() generator that already produces
 * memberships'/invitations' policies, not merely claimed to match in a
 * comment.
 */

const MIGRATION_PATH = fileURLToPath(
  new URL("../../migrations/tenancy/0003_create-notification-work-items.sql", import.meta.url),
);

let migrationSql: string;

beforeAll(async () => {
  const source = await readFile(MIGRATION_PATH, "utf8");
  const parsed = await parseMigrationFile(
    "tenancy",
    "0003_create-notification-work-items.sql",
    source,
  );
  migrationSql = parsed.sql;
});

describe("0003_create-notification-work-items.sql", () => {
  it("parses cleanly against the platform migration-file contract", async () => {
    const source = await readFile(MIGRATION_PATH, "utf8");
    const parsed = await parseMigrationFile(
      "tenancy",
      "0003_create-notification-work-items.sql",
      source,
    );
    expect(parsed.version).toBe(3);
    expect(parsed.header.lockImpact).toBe("none");
  });

  it("creates the table with every Section 4 field", () => {
    expect(migrationSql).toContain("CREATE TABLE tenancy.notification_work_items");
    for (const column of [
      "id uuid PRIMARY KEY",
      "type text NOT NULL",
      "organization_id uuid NOT NULL",
      "invitation_id uuid NOT NULL",
      "recipient text",
      "payload jsonb NOT NULL",
      "status text NOT NULL",
      "attempts integer NOT NULL",
      "created_at timestamptz NOT NULL",
      "processed_at timestamptz",
      "last_error text",
    ]) {
      expect(migrationSql).toContain(column);
    }
  });

  it("constrains type to the three handled event types and status to all four Section 7 states", () => {
    expect(migrationSql).toContain(
      "CHECK (type IN ('INVITATION_CREATED', 'INVITATION_ACCEPTED', 'INVITATION_EXPIRED'))",
    );
    expect(migrationSql).toContain(
      "CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'))",
    );
  });

  it("contains every RLS statement the generator produces", () => {
    const ddl = buildOrgScopedTableRlsDdl({
      schema: "tenancy",
      table: "notification_work_items",
      appRole: TENANCY_APP_ROLE,
      platformRole: TENANCY_PLATFORM_ROLE,
    });

    for (const statement of ddl) {
      const normalized = statement.replace(/\s+/g, " ").trim();
      expect(migrationSql.replace(/\s+/g, " ")).toContain(normalized);
    }
  });

  it("never grants DELETE to tenancy_app", () => {
    const grantLines = migrationSql
      .split("\n")
      .filter((line) => /^GRANT\b/.test(line.trim()) && line.includes("tenancy_app"));
    expect(grantLines.length).toBeGreaterThan(0);
    for (const line of grantLines) {
      expect(line).not.toMatch(/\bDELETE\b/);
    }
  });

  it("grants tenancy_platform SELECT and INSERT (not just SELECT, unlike organizations/memberships/invitations) — this is the role the real writer runs as", () => {
    const tenancyPlatformLine = migrationSql
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^GRANT .+ ON tenancy\.notification_work_items TO tenancy_platform;$/.test(line));
    expect(tenancyPlatformLine).toBeDefined();
    expect(tenancyPlatformLine).toMatch(/^GRANT SELECT, INSERT ON /);
    expect(tenancyPlatformLine).not.toMatch(/\bDELETE\b/);
  });

  it("foreign-keys organization_id to tenancy.organizations with ON DELETE CASCADE", () => {
    expect(migrationSql).toContain(
      "FOREIGN KEY (organization_id) REFERENCES tenancy.organizations (id) ON DELETE CASCADE",
    );
  });
});
