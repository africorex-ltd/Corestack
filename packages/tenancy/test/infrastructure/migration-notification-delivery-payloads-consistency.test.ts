import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";
import { parseMigrationFile } from "@corestack/platform";

import { buildOrgScopedTableRlsDdl } from "../../src/infrastructure/postgres/rls/org-scoped-table-policies.js";
import { TENANCY_APP_ROLE, TENANCY_PLATFORM_ROLE } from "../../src/infrastructure/postgres/rls/roles.js";

/**
 * Same discipline as migration-notification-work-items-consistency.test.ts
 * (E05-T14), applied to the new notification_delivery_payloads table
 * (E05-T16): the shipped migration's RLS statements are checked against
 * the same buildOrgScopedTableRlsDdl() generator every other org-scoped
 * tenancy table already uses, not merely claimed to match in a comment.
 */

const MIGRATION_PATH = fileURLToPath(
  new URL("../../migrations/tenancy/0005_create-notification-delivery-payloads.sql", import.meta.url),
);

let migrationSql: string;

beforeAll(async () => {
  const source = await readFile(MIGRATION_PATH, "utf8");
  const parsed = await parseMigrationFile(
    "tenancy",
    "0005_create-notification-delivery-payloads.sql",
    source,
  );
  migrationSql = parsed.sql;
});

describe("0005_create-notification-delivery-payloads.sql", () => {
  it("parses cleanly against the platform migration-file contract", async () => {
    const source = await readFile(MIGRATION_PATH, "utf8");
    const parsed = await parseMigrationFile(
      "tenancy",
      "0005_create-notification-delivery-payloads.sql",
      source,
    );
    expect(parsed.version).toBe(5);
    expect(parsed.header.lockImpact).toBe("none");
  });

  it("creates the table with every Section 6 field", () => {
    expect(migrationSql).toContain("CREATE TABLE tenancy.notification_delivery_payloads");
    for (const column of [
      "id uuid PRIMARY KEY",
      "organization_id uuid NOT NULL",
      "notification_type text NOT NULL",
      "recipient text",
      "payload jsonb NOT NULL",
      "created_at timestamptz NOT NULL",
    ]) {
      expect(migrationSql).toContain(column);
    }
  });

  it("constrains notification_type to the three handled types", () => {
    expect(migrationSql).toContain(
      "CHECK (notification_type IN ('INVITATION_CREATED', 'INVITATION_ACCEPTED', 'INVITATION_EXPIRED'))",
    );
  });

  it("contains every RLS statement the generator produces", () => {
    const ddl = buildOrgScopedTableRlsDdl({
      schema: "tenancy",
      table: "notification_delivery_payloads",
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

  it("grants tenancy_platform SELECT and INSERT (the role the real writer runs as)", () => {
    const tenancyPlatformLine = migrationSql
      .split("\n")
      .map((line) => line.trim())
      .find((line) =>
        /^GRANT .+ ON tenancy\.notification_delivery_payloads TO tenancy_platform;$/.test(line),
      );
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
