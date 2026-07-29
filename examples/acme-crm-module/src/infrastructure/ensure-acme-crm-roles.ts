import { ensureTenancyRoles } from "@corestack/platform/postgres";
import type { Sql } from "postgres";

export const ACME_CRM_APP_ROLE = "acme_crm_app";
export const ACME_CRM_PLATFORM_ROLE = "acme_crm_platform";

/**
 * Must run before the `0001_create-contacts.sql` migration applies — that
 * migration's `CREATE POLICY ... TO acme_crm_app` statements require the
 * role to already exist (Postgres has no `CREATE ROLE IF NOT EXISTS`, and
 * a policy can't reference a role that doesn't exist yet). Idempotent —
 * safe to call on every boot, matching T30's own `ensureTenancyRoles`
 * contract.
 *
 * Also grants the app role write access to `platform.outbox` — a real
 * gotcha found while building this example: `PostgresUnitOfWork.run()`
 * writes staged events into `platform.outbox` using the *same* connection
 * (`ctx.sql`) the module's own use case runs on. If that connection is
 * authenticated as this module's restricted app role (the realistic
 * production shape — see the tenant-isolation certification's Residual
 * Risk R3), the app role needs `INSERT` on `platform.outbox` or every
 * `UnitOfWork.run()` call that publishes an event fails with "permission
 * denied for schema platform," even though the module's own tables are
 * granted correctly. This is a platform-wide table every module's app
 * role must be granted onto, not something `buildTenantIsolationDdl`
 * (which only knows about this module's own tables) can generate.
 */
export async function ensureAcmeCrmRoles(sql: Sql): Promise<void> {
  await ensureTenancyRoles(sql, {
    appRole: ACME_CRM_APP_ROLE,
    platformRole: ACME_CRM_PLATFORM_ROLE,
  });
  await sql.unsafe(`GRANT USAGE ON SCHEMA platform TO ${ACME_CRM_APP_ROLE}`);
  await sql.unsafe(`GRANT INSERT ON platform.outbox TO ${ACME_CRM_APP_ROLE}`);
}
