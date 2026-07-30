import { describe, expect, it } from "vitest";
import { ValidationError } from "@corestack/kernel";
import type { TenantPolicyTarget } from "@corestack/platform";

import { buildOrgScopedTableRlsDdl } from "../../src/infrastructure/postgres/rls/org-scoped-table-policies.js";
import { buildOrganizationsRlsDdl } from "../../src/infrastructure/postgres/rls/organizations-policies.js";
import { TENANCY_APP_ROLE, TENANCY_PLATFORM_ROLE } from "../../src/infrastructure/postgres/rls/roles.js";

/**
 * DDL-level RLS tests (E05-T10 Section 9) — no live database. Every
 * assertion here checks the *text* the generator functions produce, the
 * same discipline `packages/platform/test/domain/tenant-policy.test.ts`
 * already established for the platform's generic policy generator.
 */

const BASE_TARGET = {
  schema: "tenancy",
  appRole: TENANCY_APP_ROLE,
  platformRole: TENANCY_PLATFORM_ROLE,
} as const;

function target(table: string): TenantPolicyTarget {
  return { ...BASE_TARGET, table };
}

/** No bind-parameter placeholder syntax anywhere — this is DDL text, never a parameterized query. */
function assertNoBindParameterPlaceholders(ddl: readonly string[]): void {
  for (const statement of ddl) {
    expect(statement).not.toMatch(/\$\d/);
  }
}

describe.each([
  ["memberships", buildOrgScopedTableRlsDdl],
  ["invitations", buildOrgScopedTableRlsDdl],
])("%s RLS DDL (org-scoped)", (table, build) => {
  const ddl = build(target(table));

  it("enables and forces row level security", () => {
    expect(ddl).toContain(`ALTER TABLE tenancy.${table} ENABLE ROW LEVEL SECURITY`);
    expect(ddl).toContain(`ALTER TABLE tenancy.${table} FORCE ROW LEVEL SECURITY`);
  });

  it("has at least one policy", () => {
    expect(ddl.some((stmt) => stmt.includes("CREATE POLICY"))).toBe(true);
  });

  it("has stable, per-command policy names for SELECT/INSERT/UPDATE, scoped to the app role", () => {
    const select = ddl.find((stmt) => stmt.includes(`${table}_select`));
    const insert = ddl.find((stmt) => stmt.includes(`${table}_insert`));
    const update = ddl.find((stmt) => stmt.includes(`${table}_update`));
    expect(select).toBeDefined();
    expect(insert).toBeDefined();
    expect(update).toBeDefined();

    expect(select).toContain("FOR SELECT");
    expect(select).toContain(`TO ${TENANCY_APP_ROLE}`);
    expect(select).toContain(`organization_id = current_setting('app.current_org')::uuid`);

    expect(insert).toContain("FOR INSERT");
    expect(insert).toContain("WITH CHECK");

    expect(update).toContain("FOR UPDATE");
    expect(update).toContain("USING");
    expect(update).toContain("WITH CHECK");
  });

  it("does not grant or policy DELETE for the app role", () => {
    expect(ddl.some((stmt) => stmt.includes(`${table}_delete`))).toBe(false);
    expect(ddl.some((stmt) => /FOR DELETE/.test(stmt) && stmt.includes(TENANCY_APP_ROLE))).toBe(
      false,
    );
  });

  it("has a platform_full_access policy covering every command, unconditionally", () => {
    const platform = ddl.find((stmt) => stmt.includes(`${table}_platform_full_access`));
    expect(platform).toBeDefined();
    expect(platform).toContain("FOR ALL");
    expect(platform).toContain(`TO ${TENANCY_PLATFORM_ROLE}`);
    expect(platform).toContain("USING (true)");
  });

  it("scopes every app-role policy via current_setting without missing_ok (fail closed)", () => {
    for (const stmt of ddl) {
      if (stmt.includes(TENANCY_APP_ROLE)) {
        expect(stmt).not.toContain("missing_ok");
        expect(stmt).not.toContain(", true)");
      }
    }
  });

  it("orders ENABLE before FORCE before the policy statements", () => {
    expect(ddl[0]).toContain("ENABLE ROW LEVEL SECURITY");
    expect(ddl[1]).toContain("FORCE ROW LEVEL SECURITY");
  });

  it("contains no bind-parameter placeholder syntax", () => {
    assertNoBindParameterPlaceholders(ddl);
  });

  it("uses a bare column reference in every USING/WITH CHECK predicate, never schema/table-qualified", () => {
    for (const stmt of ddl) {
      expect(stmt).not.toMatch(/\btenancy\.\w+\.\w+/);
    }
  });

  it.each([
    ["schema", { ...target(table), schema: "bad;schema" }],
    ["table", { ...target(table), table: "bad table" }],
    ["appRole", { ...target(table), appRole: "App_Role" }],
    ["platformRole", { ...target(table), platformRole: "1platform" }],
  ])("rejects an unsafe %s identifier", (_label, badTarget) => {
    expect(() => build(badTarget)).toThrow(ValidationError);
  });
});

describe("organizations RLS DDL (direct visibility, ADR-0024)", () => {
  const ddl = buildOrganizationsRlsDdl(target("organizations"));

  it("enables and forces row level security", () => {
    expect(ddl).toContain("ALTER TABLE tenancy.organizations ENABLE ROW LEVEL SECURITY");
    expect(ddl).toContain("ALTER TABLE tenancy.organizations FORCE ROW LEVEL SECURITY");
  });

  it("has at least one policy", () => {
    expect(ddl.some((stmt) => stmt.includes("CREATE POLICY"))).toBe(true);
  });

  it("keys SELECT/INSERT/UPDATE off id, not organization_id", () => {
    const select = ddl.find((stmt) => stmt.includes("organizations_select"));
    const insert = ddl.find((stmt) => stmt.includes("organizations_insert"));
    const update = ddl.find((stmt) => stmt.includes("organizations_update"));
    expect(select).toContain("id = current_setting('app.current_org')::uuid");
    expect(insert).toContain("id = current_setting('app.current_org')::uuid");
    expect(update).toContain("id = current_setting('app.current_org')::uuid");
    for (const stmt of [select, insert, update]) {
      expect(stmt).not.toContain("organization_id");
    }
  });

  it("uses a bare column reference in every USING/WITH CHECK predicate, never schema/table-qualified", () => {
    for (const stmt of ddl) {
      expect(stmt).not.toMatch(/\btenancy\.\w+\.\w+/);
    }
  });

  it("uses the identical predicate for INSERT as for SELECT/UPDATE (no special-cased creation bypass)", () => {
    const select = ddl.find((stmt) => stmt.includes("organizations_select"))!;
    const insert = ddl.find((stmt) => stmt.includes("organizations_insert"))!;
    const selectPredicate = select.match(/USING \((.+)\)/)?.[1];
    const insertPredicate = insert.match(/WITH CHECK \((.+)\)/)?.[1];
    expect(selectPredicate).toBeDefined();
    expect(insertPredicate).toBe(selectPredicate);
  });

  it("does not grant or policy DELETE", () => {
    expect(ddl.some((stmt) => stmt.includes("organizations_delete"))).toBe(false);
  });

  it("has a platform_full_access policy for future cross-organization administration", () => {
    const platform = ddl.find((stmt) => stmt.includes("organizations_platform_full_access"));
    expect(platform).toBeDefined();
    expect(platform).toContain("FOR ALL");
    expect(platform).toContain(`TO ${TENANCY_PLATFORM_ROLE}`);
    expect(platform).toContain("USING (true)");
  });

  it("scopes every app-role policy via current_setting without missing_ok (fail closed)", () => {
    for (const stmt of ddl) {
      if (stmt.includes(TENANCY_APP_ROLE)) {
        expect(stmt).not.toContain("missing_ok");
        expect(stmt).not.toContain(", true)");
      }
    }
  });

  it("orders ENABLE before FORCE before the policy statements", () => {
    expect(ddl[0]).toContain("ENABLE ROW LEVEL SECURITY");
    expect(ddl[1]).toContain("FORCE ROW LEVEL SECURITY");
  });

  it("contains no bind-parameter placeholder syntax", () => {
    assertNoBindParameterPlaceholders(ddl);
  });

  it.each([
    ["schema", { ...target("organizations"), schema: "bad;schema" }],
    ["table", { ...target("organizations"), table: "bad table" }],
    ["appRole", { ...target("organizations"), appRole: "App_Role" }],
    ["platformRole", { ...target("organizations"), platformRole: "1platform" }],
  ])("rejects an unsafe %s identifier", (_label, badTarget) => {
    expect(() => buildOrganizationsRlsDdl(badTarget)).toThrow(ValidationError);
  });
});
