/**
 * Real-Postgres integration tests for E03-T31 (org-scoped repository base
 * utilities): `OrgScopedContext`/`requireOrgScoped`/`runOrgScopedQuery`
 * proven together via a real fixture repository
 * (`fixtures/fixture-widget-repository.ts`).
 *
 * Unlike E03-T30's own integration tests (which exercise the restricted
 * role via `SET LOCAL ROLE` from a superuser session), this file connects
 * to the app role via a **genuinely separate, directly authenticated**
 * connection — closing the exact gap T30's component spec documents as a
 * known harness limitation ("does not prove behavior is identical for a
 * connection authenticated directly as the restricted role"). The app
 * role is normally `NOLOGIN` in production (E03-T40 hasn't decided real
 * credentials yet); this test temporarily grants it a login password
 * scoped to the disposable per-test scratch database only, purely to get
 * a real authenticated connection for this one proof.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import { createContext, SequentialIdGenerator } from "@corestack/kernel";

import { buildTenantIsolationDdl } from "../../src/domain/tenant-policy.js";
import { ensureTenancyRoles } from "../../src/infrastructure/postgres-tenancy-roles.js";
import { requireOrgScoped } from "../../src/application/org-scoped-context.js";
import { createTestDatabase, type TestDatabase } from "../../test-support/test-database.js";
import { FixtureWidgetRepository } from "./fixtures/fixture-widget-repository.js";

let db: TestDatabase;
let sql: Sql;
let appRoleSql: Sql;

const APP_ROLE = "org_repo_fixture_app_role";
const PLATFORM_ROLE = "org_repo_fixture_platform_role";
const APP_ROLE_PASSWORD = "test-only-scratch-db-password";
const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

const ids = () => new SequentialIdGenerator("corr-");

beforeAll(async () => {
  db = await createTestDatabase();
  sql = db.sql;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await sql.unsafe(`DROP SCHEMA IF EXISTS tenant_fixture CASCADE`);
  await sql.unsafe(`CREATE SCHEMA tenant_fixture`);
  await sql.unsafe(`
    CREATE TABLE tenant_fixture.widgets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      note text NOT NULL
    )
  `);
  await sql`
    INSERT INTO tenant_fixture.widgets (organization_id, note) VALUES
    (${ORG_A}::uuid, 'org-a-widget'),
    (${ORG_B}::uuid, 'org-b-widget')
  `;

  await ensureTenancyRoles(sql, { appRole: APP_ROLE, platformRole: PLATFORM_ROLE });
  for (const statement of buildTenantIsolationDdl({
    schema: "tenant_fixture",
    table: "widgets",
    appRole: APP_ROLE,
    platformRole: PLATFORM_ROLE,
  })) {
    await sql.unsafe(statement);
  }
  await sql.unsafe(`GRANT USAGE ON SCHEMA tenant_fixture TO ${APP_ROLE}`);
  await sql.unsafe(`GRANT SELECT ON tenant_fixture.widgets TO ${APP_ROLE}`);

  // Test-only: grant a login password so this test can connect directly as
  // the app role (real production credentials are E03-T40's decision;
  // this is scoped to a disposable per-test scratch database only).
  await sql.unsafe(`ALTER ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE_PASSWORD}'`);

  const appRoleUrl = new URL(db.connectionString);
  appRoleUrl.username = APP_ROLE;
  appRoleUrl.password = APP_ROLE_PASSWORD;
  appRoleSql = postgres(appRoleUrl.toString(), { max: 5, onnotice: () => {} });
});

afterEach(async () => {
  await appRoleSql?.end({ timeout: 5 });
});

describe("FixtureWidgetRepository over a directly-authenticated app-role connection (E03-T31 integration)", () => {
  it("returns only org A's widget for a context scoped to org A", async () => {
    const repo = new FixtureWidgetRepository(appRoleSql);
    const context = requireOrgScoped(
      createContext({ actor: { type: "user", id: "u1" }, organizationId: ORG_A }, ids()),
    );
    const widgets = await repo.list(context);
    expect(widgets.map((w) => w.note)).toEqual(["org-a-widget"]);
  });

  it("returns only org B's widget for a context scoped to org B", async () => {
    const repo = new FixtureWidgetRepository(appRoleSql);
    const context = requireOrgScoped(
      createContext({ actor: { type: "user", id: "u1" }, organizationId: ORG_B }, ids()),
    );
    const widgets = await repo.list(context);
    expect(widgets.map((w) => w.note)).toEqual(["org-b-widget"]);
  });

  it("a raw query on the same pool outside runOrgScopedQuery fails loudly rather than leaking rows", async () => {
    // T30's finding: once this pooled connection has set app.current_org
    // in one transaction (via the repo call above), a later transaction on
    // the same pool that skips runOrgScopedQuery sees the reset value, not
    // NULL, and the un-hedged tenant_isolation policy throws. This is the
    // production connection shape (directly authenticated as the app
    // role), not the superuser-session shape T30's own tests exercised —
    // proving the fail-loud claim actually holds here, not just there.
    const repo = new FixtureWidgetRepository(appRoleSql);
    const context = requireOrgScoped(
      createContext({ actor: { type: "user", id: "u1" }, organizationId: ORG_A }, ids()),
    );
    await repo.list(context);

    await expect(appRoleSql`SELECT note FROM tenant_fixture.widgets`).rejects.toThrow(
      /unrecognized configuration parameter|invalid input syntax/,
    );
  });

  it("SECURITY MATRIX §4.4: concurrent requests for two different orgs on the same shared pool never cross-contaminate", async () => {
    const repo = new FixtureWidgetRepository(appRoleSql);
    const contextA = requireOrgScoped(
      createContext({ actor: { type: "user", id: "u1" }, organizationId: ORG_A }, ids()),
    );
    const contextB = requireOrgScoped(
      createContext({ actor: { type: "user", id: "u2" }, organizationId: ORG_B }, ids()),
    );

    // 10 concurrent calls per org, interleaved, against the same 5-connection
    // pool — proving set_config's transaction-scoping genuinely isolates
    // concurrent transactions sharing a pool, not just sequential reuse.
    const calls = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? repo.list(contextA) : repo.list(contextB),
    );
    const results = await Promise.all(calls);

    results.forEach((widgets, i) => {
      const expected = i % 2 === 0 ? ["org-a-widget"] : ["org-b-widget"];
      expect(widgets.map((w) => w.note)).toEqual(expected);
    });
  });
});
