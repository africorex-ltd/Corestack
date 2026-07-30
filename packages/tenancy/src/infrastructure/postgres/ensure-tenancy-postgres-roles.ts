import { ensureTenancyRoles } from "@corestack/platform/postgres";
import type { Sql } from "postgres";

import { TENANCY_APP_ROLE, TENANCY_PLATFORM_ROLE } from "./rls/roles.js";

/**
 * Must run before the `0002_create-tenancy-tables.sql` migration applies
 * — that migration's `CREATE POLICY ... TO tenancy_app`/`TO
 * tenancy_platform` statements require both roles to already exist
 * (Postgres has no `CREATE ROLE IF NOT EXISTS`, and a policy can't
 * reference a role that doesn't exist yet). Idempotent — safe to call on
 * every boot, matching `examples/acme-crm-module`'s exact precedent
 * (`ensure-acme-crm-roles.ts`) and E03-T30's own `ensureTenancyRoles`
 * contract.
 *
 * Also grants the app role write access to `platform.outbox` — the same
 * gotcha acme-crm's own bootstrap already documents: `PostgresUnitOfWork`
 * writes staged domain events into `platform.outbox` on the *same*
 * connection the module's use case runs on, so if that connection is
 * authenticated as `tenancy_app` (the realistic production shape), the
 * role needs `INSERT` on `platform.outbox` or every `UnitOfWork.run()`
 * call that publishes an event (every use case this module has —
 * `createOrganization`/`inviteMember`/`acceptInvitation` all publish)
 * fails with "permission denied for schema platform."
 */
export async function ensureTenancyModuleRoles(sql: Sql): Promise<void> {
  await ensureTenancyRoles(sql, {
    appRole: TENANCY_APP_ROLE,
    platformRole: TENANCY_PLATFORM_ROLE,
  });
  await sql.unsafe(`GRANT USAGE ON SCHEMA platform TO ${TENANCY_APP_ROLE}`);
  await sql.unsafe(`GRANT INSERT ON platform.outbox TO ${TENANCY_APP_ROLE}`);
}
