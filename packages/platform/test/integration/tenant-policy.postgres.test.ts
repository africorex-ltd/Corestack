/**
 * Real-Postgres integration tests for E03-T30 (RLS harness; DB §15;
 * ADR-0008 layer 3): `ensureTenancyRoles`, `buildTenantIsolationDdl`, and
 * `withOrgContext` proven together against a fixture table.
 *
 * Two things this harness must prove in both directions (not just "wrong
 * org gets nothing" — a role that can't see the table *at all* would pass
 * that half vacuously):
 * - the app role scoped to org A sees org A's own row and not org B's;
 * - the platform role sees every row regardless of `app.current_org`.
 *
 * The restricted app role is exercised via `SET LOCAL ROLE` (test-support's
 * `withRole`), not a real login credential — `ensureTenancyRoles` creates
 * both roles `NOLOGIN`, matching DB §15 (nothing connects directly as
 * either role until a future connection-pooling task wires up real
 * per-role credentials).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "postgres";

import { buildTenantIsolationDdl } from "../../src/domain/tenant-policy.js";
import { ensureTenancyRoles } from "../../src/infrastructure/postgres-tenancy-roles.js";
import { withOrgContext } from "../../src/infrastructure/postgres-org-context.js";
import {
  createTestDatabase,
  withRole,
  type TestDatabase,
} from "../../test-support/test-database.js";

let db: TestDatabase;
let sql: Sql;

const APP_ROLE = "tenant_fixture_app_role";
const PLATFORM_ROLE = "tenant_fixture_platform_role";
const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

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
  await sql.unsafe(`GRANT USAGE ON SCHEMA tenant_fixture TO ${APP_ROLE}, ${PLATFORM_ROLE}`);
  await sql.unsafe(`GRANT SELECT ON tenant_fixture.widgets TO ${APP_ROLE}, ${PLATFORM_ROLE}`);
});

describe("tenant isolation RLS policy (E03-T30 integration)", () => {
  it("the app role scoped to org A sees org A's row and not org B's", async () => {
    const rows = await withRole(sql, APP_ROLE, async (tx) => {
      await tx`SELECT set_config('app.current_org', ${ORG_A}, true)`;
      return tx<{ note: string }[]>`SELECT note FROM tenant_fixture.widgets ORDER BY note`;
    });
    expect(rows.map((r) => r.note)).toEqual(["org-a-widget"]);
  });

  it("the app role scoped to org B sees org B's row and not org A's", async () => {
    const rows = await withRole(sql, APP_ROLE, async (tx) => {
      await tx`SELECT set_config('app.current_org', ${ORG_B}, true)`;
      return tx<{ note: string }[]>`SELECT note FROM tenant_fixture.widgets ORDER BY note`;
    });
    expect(rows.map((r) => r.note)).toEqual(["org-b-widget"]);
  });

  it("the app role with no org context set fails loudly rather than returning rows silently", async () => {
    await expect(
      withRole(sql, APP_ROLE, async (tx) => {
        return tx`SELECT note FROM tenant_fixture.widgets`;
      }),
    ).rejects.toThrow(/unrecognized configuration parameter|invalid input syntax/);
  });

  it("the platform role sees every row regardless of app.current_org", async () => {
    const rows = await withRole(sql, PLATFORM_ROLE, async (tx) => {
      return tx<{ note: string }[]>`SELECT note FROM tenant_fixture.widgets ORDER BY note`;
    });
    expect(rows.map((r) => r.note)).toEqual(["org-a-widget", "org-b-widget"]);
  });

  it("a superuser bypasses RLS even with FORCE set (Postgres's own exemption)", async () => {
    // Proves FORCE ROW LEVEL SECURITY is actually doing something — without
    // it, the owning superuser silently bypasses every policy.
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org', ${ORG_A}, true)`;
      return tx<{ note: string }[]>`SELECT note FROM tenant_fixture.widgets`;
    });
    // A real superuser bypasses RLS regardless of FORCE (FORCE only affects
    // the table owner acting in a *non-superuser* capacity); this assertion
    // documents that distinction rather than asserting isolation for a role
    // that Postgres deliberately never restricts.
    expect(rows.map((r) => r.note).sort()).toEqual(["org-a-widget", "org-b-widget"]);
  });
});

describe("withOrgContext (E03-T30.3 integration)", () => {
  it("sets app.current_org for the duration of the transaction and reverts after commit", async () => {
    const insideValue = await withOrgContext(sql, ORG_A, async (tx) => {
      const rows = await tx<{ v: string }[]>`SELECT current_setting('app.current_org', true) AS v`;
      return rows[0]?.v;
    });
    expect(insideValue).toBe(ORG_A);

    const after = await sql<
      { v: string | null }[]
    >`SELECT current_setting('app.current_org', true) AS v`;
    expect(after[0]?.v === null || after[0]?.v === "").toBe(true);
  });

  it("propagates the callback's return value", async () => {
    const result = await withOrgContext(sql, ORG_A, async () => 42);
    expect(result).toBe(42);
  });
});
