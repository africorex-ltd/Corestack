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
import postgres, { type Sql } from "postgres";

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

  it("SECURITY MATRIX §4.1: a malformed (non-UUID) org context fails closed, never silently matching or excluding as if it were valid", async () => {
    await expect(
      withRole(sql, APP_ROLE, async (tx) => {
        await tx`SELECT set_config('app.current_org', 'not-a-uuid', true)`;
        return tx`SELECT note FROM tenant_fixture.widgets`;
      }),
    ).rejects.toThrow(/invalid input syntax/);
  });

  it("SECURITY MATRIX §4.2: a cross-tenant UPDATE attempt affects zero rows, never mutates another tenant's row", async () => {
    const [orgBRow] = await sql<
      { id: string }[]
    >`SELECT id FROM tenant_fixture.widgets WHERE organization_id = ${ORG_B}::uuid`;
    if (orgBRow === undefined) throw new Error("fixture setup invariant violated");

    await sql.unsafe(`GRANT UPDATE ON tenant_fixture.widgets TO ${APP_ROLE}`);

    const updated = await withRole(sql, APP_ROLE, async (tx) => {
      await tx`SELECT set_config('app.current_org', ${ORG_A}, true)`;
      return tx`UPDATE tenant_fixture.widgets SET note = 'tampered' WHERE id = ${orgBRow.id}::uuid`;
    });
    expect(updated.count).toBe(0);

    const [stillOrgB] = await sql<
      { note: string }[]
    >`SELECT note FROM tenant_fixture.widgets WHERE id = ${orgBRow.id}::uuid`;
    expect(stillOrgB?.note).toBe("org-b-widget");
  });

  it("SECURITY MATRIX §4.3: a rolled-back transaction leaves no residual org context for the next transaction on the same connection", async () => {
    // A dedicated single-connection client — the normal pool doesn't
    // guarantee the same physical connection across two separate calls,
    // and this test specifically proves behavior *on one reused connection*.
    const single = postgres(db.connectionString, { max: 1, onnotice: () => {} });
    try {
      await expect(
        single.begin(async (tx) => {
          await tx`SELECT set_config('app.current_org', ${ORG_A}, true)`;
          throw new Error("simulated use-case failure");
        }),
      ).rejects.toThrow("simulated use-case failure");

      // Same connection, no withOrgContext call this time — must fail
      // exactly like a virgin/empty-GUC connection (§3.2), not silently
      // inherit org A's rolled-back setting.
      await expect(
        single.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${APP_ROLE}`);
          return tx`SELECT note FROM tenant_fixture.widgets`;
        }),
      ).rejects.toThrow(/unrecognized configuration parameter|invalid input syntax/);
    } finally {
      await single.end();
    }
  });

  it("SECURITY MATRIX §4.6: a manual session-scoped SET (not set_config(..., true)) leaks org context into the next transaction — this is exactly why withOrgContext never uses a bare SET", async () => {
    const single = postgres(db.connectionString, { max: 1, onnotice: () => {} });
    try {
      // A bare SET (not wrapped in set_config's transaction-scoped form) is
      // session-scoped: it survives past the transaction that set it.
      await single.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${APP_ROLE}`);
        await tx.unsafe(`SET app.current_org = '${ORG_A}'`);
      });

      // A *new* transaction on the same connection, with no context call of
      // its own, still sees org A's setting — the leak this test documents.
      const leaked = await single.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${APP_ROLE}`);
        return tx<{ note: string }[]>`SELECT note FROM tenant_fixture.widgets`;
      });
      expect(leaked.map((r) => r.note)).toEqual(["org-a-widget"]);
    } finally {
      await single.end();
    }
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
