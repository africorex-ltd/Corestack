import { describe, expect, it } from "vitest";
import { ValidationError } from "@corestack/kernel";

import { buildTenantIsolationDdl } from "../../src/domain/tenant-policy.js";

describe("buildTenantIsolationDdl", () => {
  const target = {
    schema: "fixtures",
    table: "widgets",
    appRole: "corestack_app",
    platformRole: "corestack_platform",
  };

  it("emits FORCE (not just ENABLE) row level security", () => {
    const ddl = buildTenantIsolationDdl(target);
    expect(ddl).toContain("ALTER TABLE fixtures.widgets ENABLE ROW LEVEL SECURITY");
    expect(ddl).toContain("ALTER TABLE fixtures.widgets FORCE ROW LEVEL SECURITY");
  });

  it("scopes the tenant_isolation policy to the app role via current_setting without missing_ok", () => {
    const ddl = buildTenantIsolationDdl(target);
    const policy = ddl.find((stmt) => stmt.includes("tenant_isolation"));
    expect(policy).toBeDefined();
    expect(policy).toContain("TO corestack_app");
    expect(policy).toContain("current_setting('app.current_org')::uuid");
    expect(policy).not.toContain("missing_ok");
    expect(policy).not.toContain(", true)");
  });

  it("scopes the platform_full_access policy to the platform role with an unconditional predicate", () => {
    const ddl = buildTenantIsolationDdl(target);
    const policy = ddl.find((stmt) => stmt.includes("platform_full_access"));
    expect(policy).toBeDefined();
    expect(policy).toContain("TO corestack_platform");
    expect(policy).toContain("USING (true)");
  });

  it("orders ENABLE before FORCE before the two CREATE POLICY statements", () => {
    const ddl = buildTenantIsolationDdl(target);
    const kinds = ddl.map((stmt) =>
      stmt.includes("ENABLE ROW LEVEL SECURITY")
        ? "enable"
        : stmt.includes("FORCE ROW LEVEL SECURITY")
          ? "force"
          : stmt.includes("tenant_isolation")
            ? "tenant"
            : "platform",
    );
    expect(kinds).toEqual(["enable", "force", "tenant", "platform"]);
  });

  it.each([
    ["schema", { ...target, schema: "bad;schema" }],
    ["table", { ...target, table: "bad table" }],
    ["appRole", { ...target, appRole: "App_Role" }],
    ["platformRole", { ...target, platformRole: "1platform" }],
  ])("rejects an unsafe %s identifier", (_label, badTarget) => {
    expect(() => buildTenantIsolationDdl(badTarget)).toThrow(ValidationError);
  });
});
