import { describe, expect, it } from "vitest";
import { Param, type SQL } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import { OrganizationStatus } from "../../src/domain/organization-status.js";
import { MembershipRole } from "../../src/domain/membership-role.js";
import { MembershipStatus } from "../../src/domain/membership-status.js";
import { InvitationRole } from "../../src/domain/invitation-role.js";
import { InvitationStatus } from "../../src/domain/invitation-status.js";
import {
  tenancySchema,
  organizations,
  memberships,
  invitations,
} from "../../src/infrastructure/postgres/schema/index.js";

/**
 * Schema tests (E05-T09 Section 10) — no live database. `getTableConfig`
 * introspects the Drizzle table definitions built in memory; every
 * assertion here is checkable from the schema's own in-process shape.
 */

function columnNames(index: ReturnType<typeof getTableConfig>["indexes"][number]): string[] {
  return index.config.columns.map((column) => {
    if ("name" in column && typeof column.name === "string") {
      return column.name;
    }
    throw new Error("expected an indexed column, got a raw SQL expression");
  });
}

/**
 * Recursively confirms no bind-parameter placeholder (`Param`) appears
 * anywhere in a `CHECK`/partial-index `WHERE` expression tree. A `CHECK`
 * constraint or partial index's `WHERE` clause is DDL, not a query — it
 * can never contain a bind parameter, only literal SQL text (ADR-0023:
 * `sqlInList` inlines its value list via `sql.raw` for exactly this
 * reason). This is the assertion the schema tests were missing before:
 * confirming a check exists by name doesn't confirm its SQL is valid DDL.
 */
function assertNoBindParameters(expression: SQL): void {
  for (const chunk of expression.queryChunks) {
    if (chunk instanceof Param) {
      throw new Error("CHECK/WHERE expression contains a bind parameter — not renderable as DDL");
    }
    if (chunk !== null && typeof chunk === "object" && "queryChunks" in chunk) {
      assertNoBindParameters(chunk as SQL);
    }
  }
}

describe("tenancy Postgres schema — builds", () => {
  it("names the schema 'tenancy'", () => {
    expect(tenancySchema.schemaName).toBe("tenancy");
  });

  it("builds all three tables under the tenancy schema", () => {
    expect(getTableConfig(organizations).schema).toBe("tenancy");
    expect(getTableConfig(memberships).schema).toBe("tenancy");
    expect(getTableConfig(invitations).schema).toBe("tenancy");
    expect(getTableConfig(organizations).name).toBe("organizations");
    expect(getTableConfig(memberships).name).toBe("memberships");
    expect(getTableConfig(invitations).name).toBe("invitations");
  });
});

describe("tenancy.organizations", () => {
  const config = getTableConfig(organizations);

  it("has the Section 4 column set, each not-null except deleted_at", () => {
    const columnsByName = new Map(config.columns.map((column) => [column.name, column]));
    for (const name of ["id", "slug", "name", "status", "created_at", "updated_at"]) {
      expect(columnsByName.get(name)?.notNull).toBe(true);
    }
    expect(columnsByName.get("deleted_at")?.notNull).toBe(false);
    expect(columnsByName.get("id")?.primary).toBe(true);
  });

  it("status enum values match the OrganizationStatus domain enum exactly", () => {
    const status = config.columns.find((column) => column.name === "status");
    expect(status?.enumValues).toEqual(Object.values(OrganizationStatus));
  });

  it("has a status CHECK constraint enumerating the same values (ADR-0023)", () => {
    const check = config.checks.find((c) => c.name === "organizations_status_check");
    expect(check).toBeDefined();
    assertNoBindParameters(check!.value);
  });

  it("has a plain unique index on slug", () => {
    const slugIndex = config.indexes.find((index) => index.config.name === "organizations_slug_key");
    expect(slugIndex).toBeDefined();
    expect(slugIndex?.config.unique).toBe(true);
    expect(slugIndex?.config.where).toBeUndefined();
    expect(columnNames(slugIndex!)).toEqual(["slug"]);
  });

  it("has a plain (non-unique) index on status", () => {
    const statusIndex = config.indexes.find(
      (index) => index.config.name === "organizations_status_idx",
    );
    expect(statusIndex).toBeDefined();
    expect(statusIndex?.config.unique).toBe(false);
    expect(columnNames(statusIndex!)).toEqual(["status"]);
  });

  it("has no foreign keys (it is the tenancy root)", () => {
    expect(config.foreignKeys).toHaveLength(0);
  });
});

describe("tenancy.memberships", () => {
  const config = getTableConfig(memberships);

  it("has the Section 5 column set, each not-null except removed_at", () => {
    const columnsByName = new Map(config.columns.map((column) => [column.name, column]));
    for (const name of [
      "id",
      "organization_id",
      "user_id",
      "role",
      "status",
      "joined_at",
      "updated_at",
    ]) {
      expect(columnsByName.get(name)?.notNull).toBe(true);
    }
    expect(columnsByName.get("removed_at")?.notNull).toBe(false);
    expect(columnsByName.get("id")?.primary).toBe(true);
  });

  it("role enum values match the MembershipRole domain enum exactly", () => {
    const role = config.columns.find((column) => column.name === "role");
    expect(role?.enumValues).toEqual(Object.values(MembershipRole));
  });

  it("status enum values match the MembershipStatus domain enum exactly", () => {
    const status = config.columns.find((column) => column.name === "status");
    expect(status?.enumValues).toEqual(Object.values(MembershipStatus));
  });

  it("has role and status CHECK constraints", () => {
    const roleCheck = config.checks.find((c) => c.name === "memberships_role_check");
    const statusCheck = config.checks.find((c) => c.name === "memberships_status_check");
    expect(roleCheck).toBeDefined();
    expect(statusCheck).toBeDefined();
    assertNoBindParameters(roleCheck!.value);
    assertNoBindParameters(statusCheck!.value);
  });

  it("foreign-keys organization_id to organizations(id), CASCADE on delete", () => {
    expect(config.foreignKeys).toHaveLength(1);
    const fk = config.foreignKeys[0]!;
    expect(fk.onDelete).toBe("cascade");
    const reference = fk.reference();
    expect(reference.foreignTable).toBe(organizations);
    expect(reference.columns.map((column) => column.name)).toEqual(["organization_id"]);
    expect(reference.foreignColumns.map((column) => column.name)).toEqual(["id"]);
  });

  it("has a partial unique index on (organization_id, user_id) scoped to ACTIVE — the active-membership rule", () => {
    const activeIndex = config.indexes.find(
      (index) => index.config.name === "memberships_active_org_user_key",
    );
    expect(activeIndex).toBeDefined();
    expect(activeIndex?.config.unique).toBe(true);
    expect(activeIndex?.config.where).toBeDefined();
    assertNoBindParameters(activeIndex!.config.where!);
    expect(columnNames(activeIndex!)).toEqual(["organization_id", "user_id"]);
  });

  it("has a plain (non-unique, non-partial) index on (organization_id, user_id) for all-status lookups", () => {
    const orgUserIndex = config.indexes.find(
      (index) => index.config.name === "memberships_org_user_idx",
    );
    expect(orgUserIndex).toBeDefined();
    expect(orgUserIndex?.config.unique).toBe(false);
    expect(orgUserIndex?.config.where).toBeUndefined();
    expect(columnNames(orgUserIndex!)).toEqual(["organization_id", "user_id"]);
  });
});

describe("tenancy.invitations", () => {
  const config = getTableConfig(invitations);

  it("has the Section 6 column set, each not-null except responded_at", () => {
    const columnsByName = new Map(config.columns.map((column) => [column.name, column]));
    for (const name of [
      "id",
      "organization_id",
      "email",
      "role",
      "status",
      "invited_by",
      "created_at",
      "expires_at",
    ]) {
      expect(columnsByName.get(name)?.notNull).toBe(true);
    }
    expect(columnsByName.get("responded_at")?.notNull).toBe(false);
    expect(columnsByName.get("id")?.primary).toBe(true);
  });

  it("has no token_hash column (matches the tokenless Invitation aggregate, E05-T05)", () => {
    const names = config.columns.map((column) => column.name);
    expect(names).not.toContain("token_hash");
  });

  it("role enum values match the InvitationRole domain enum exactly (ADMIN/MEMBER, no OWNER)", () => {
    const role = config.columns.find((column) => column.name === "role");
    expect(role?.enumValues).toEqual(Object.values(InvitationRole));
    expect(role?.enumValues).not.toContain("OWNER");
  });

  it("status enum values match the InvitationStatus domain enum exactly", () => {
    const status = config.columns.find((column) => column.name === "status");
    expect(status?.enumValues).toEqual(Object.values(InvitationStatus));
  });

  it("has role and status CHECK constraints", () => {
    const roleCheck = config.checks.find((c) => c.name === "invitations_role_check");
    const statusCheck = config.checks.find((c) => c.name === "invitations_status_check");
    expect(roleCheck).toBeDefined();
    expect(statusCheck).toBeDefined();
    assertNoBindParameters(roleCheck!.value);
    assertNoBindParameters(statusCheck!.value);
  });

  it("foreign-keys organization_id to organizations(id), CASCADE on delete", () => {
    expect(config.foreignKeys).toHaveLength(1);
    const fk = config.foreignKeys[0]!;
    expect(fk.onDelete).toBe("cascade");
    expect(fk.reference().foreignTable).toBe(organizations);
  });

  it("has a partial unique index on (organization_id, email) scoped to PENDING", () => {
    const pendingIndex = config.indexes.find(
      (index) => index.config.name === "invitations_pending_org_email_key",
    );
    expect(pendingIndex).toBeDefined();
    expect(pendingIndex?.config.unique).toBe(true);
    expect(pendingIndex?.config.where).toBeDefined();
    assertNoBindParameters(pendingIndex!.config.where!);
    expect(columnNames(pendingIndex!)).toEqual(["organization_id", "email"]);
  });

  it("has a plain index on organization_id for all-status listForOrganization lookups", () => {
    const orgIndex = config.indexes.find(
      (index) => index.config.name === "invitations_organization_idx",
    );
    expect(orgIndex).toBeDefined();
    expect(orgIndex?.config.unique).toBe(false);
    expect(columnNames(orgIndex!)).toEqual(["organization_id"]);
  });
});
