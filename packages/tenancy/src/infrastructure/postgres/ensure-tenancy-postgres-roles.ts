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
 *
 * **`GRANT tenancy_platform TO tenancy_app WITH INHERIT FALSE`** (E05-T11)
 * — lets `tenancy_app` elevate to `tenancy_platform` via an explicit
 * `SET LOCAL ROLE tenancy_platform` inside a single transaction (used by
 * `PostgresOrganizationRepository.existsBySlug`/`findBySlug` to see
 * across every organization, not just the caller's current one — see
 * `docs/modules/tenancy-postgres-adapters.md`'s "RLS assumptions").
 * **`WITH INHERIT FALSE` is load-bearing, not a style choice**: verified
 * empirically that a plain `GRANT role TO other_role` (the PG16+ default,
 * `WITH INHERIT TRUE`) makes every one of `tenancy_app`'s own RLS-scoped
 * queries silently also satisfy `tenancy_platform`'s `USING (true)`
 * policy — Postgres evaluates RLS against the union of every role a
 * session is a member of when that membership inherits, so an inheriting
 * grant here would permanently disable tenant isolation for the app role,
 * not just enable a deliberate, explicit elevation. `WITH INHERIT FALSE`
 * requires the exact `SET LOCAL ROLE` statement to activate the grant;
 * confirmed (same empirical pass) that without it, `SET LOCAL ROLE`
 * itself fails outright with "permission denied to set role" — this
 * grant is what makes the elevation possible at all for a real,
 * directly-authenticated `tenancy_app` connection (a superuser test
 * session can `SET LOCAL ROLE` into anything regardless, per E03-T30's
 * own finding — this grant matters for the production shape, not the
 * test harness).
 *
 * **`platform.processed_events` access for `tenancy_platform`** (E05-T14)
 * — the invitation-notification consumer
 * (`invitation-notification-consumer.ts`) runs its own transaction
 * elevated to `tenancy_platform` (the same elevation `existsBySlug`/
 * `findBySlug` use) and needs to read/write the kernel's shared
 * idempotency-tracking table from that same elevated session to get
 * "duplicate event -> no duplicate work item" atomically with the
 * work-item insert. `platform.processed_events` carries no RLS of its
 * own (unlike every `tenancy.*` table) — this is a plain `GRANT`, no new
 * policy needed. `tenancy_app` is deliberately not granted this directly:
 * only the elevated `tenancy_platform` session ever touches this table
 * from this module, the same asymmetry `GRANT INSERT ON platform.outbox`
 * above has with `tenancy_app` for the opposite (producer-side) case.
 */
export async function ensureTenancyModuleRoles(sql: Sql): Promise<void> {
  await ensureTenancyRoles(sql, {
    appRole: TENANCY_APP_ROLE,
    platformRole: TENANCY_PLATFORM_ROLE,
  });
  await sql.unsafe(`GRANT USAGE ON SCHEMA platform TO ${TENANCY_APP_ROLE}`);
  await sql.unsafe(`GRANT INSERT ON platform.outbox TO ${TENANCY_APP_ROLE}`);
  await sql.unsafe(
    `GRANT ${TENANCY_PLATFORM_ROLE} TO ${TENANCY_APP_ROLE} WITH INHERIT FALSE`,
  );
  await sql.unsafe(`GRANT USAGE ON SCHEMA platform TO ${TENANCY_PLATFORM_ROLE}`);
  await sql.unsafe(
    `GRANT SELECT, INSERT ON platform.processed_events TO ${TENANCY_PLATFORM_ROLE}`,
  );
}
