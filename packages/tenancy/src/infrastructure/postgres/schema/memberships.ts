import { check, index, timestamp, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { MembershipRole } from "../../../domain/membership-role.js";
import { MembershipStatus } from "../../../domain/membership-status.js";
import { organizations } from "./organizations.js";
import { tenancySchema } from "./tenancy-pg-schema.js";
import { sqlInList } from "./sql-in-list.js";

const MEMBERSHIP_ROLE_VALUES = [
  MembershipRole.Owner,
  MembershipRole.Admin,
  MembershipRole.Member,
] as const;

const MEMBERSHIP_STATUS_VALUES = [
  MembershipStatus.Active,
  MembershipStatus.Suspended,
  MembershipStatus.Removed,
] as const;

/**
 * `tenancy.memberships` — E05-T09 Section 5. Column set matches the
 * implemented `Membership` aggregate (E05-T04) exactly: `joined_at`
 * doubles as this row's creation timestamp (the aggregate has no
 * separate `createdAt`), and there is no `version` column (same
 * reconciliation note as `organizations` — see `docs/modules/tenancy-
 * schema-design.md`'s "concurrency expectations").
 *
 * `user_id` has no foreign key: it references a user by id only, into a
 * schema this module doesn't own (DATABASE.md §1 rule 4 — cross-module
 * references are plain `uuid` columns, integrity via events/
 * reconciliation, never a cross-schema FK).
 *
 * **RLS attachment point (E05-T10, not implemented here — Section 11):**
 * unlike `organizations`, this table is unambiguously org-scoped
 * (`organization_id` on every row) — the standard
 * `buildTenantIsolationDdl` policy (`@corestack/platform`'s
 * `tenant-policy.ts`, E03-T30) attaches here with no open question, the
 * same way it already attaches to `tenant_fixture.widgets` in
 * `examples/acme-crm-module`'s golden path.
 */
export const memberships = tenancySchema.table(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: text("role", { enum: MEMBERSHIP_ROLE_VALUES }).notNull(),
    status: text("status", { enum: MEMBERSHIP_STATUS_VALUES }).notNull(),
    // No DB-side default — same rationale as organizations.created_at:
    // the aggregate always supplies this instant, matching the
    // `MembershipCreated` event's own `occurredAt`.
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    // Partial unique index — the active-membership rule (Section 5):
    // at most one ACTIVE membership per (organization, user). Scoped to
    // `status = 'ACTIVE'` only, not "not REMOVED" — a SUSPENDED
    // membership is still the user's one current relationship (no
    // repository path creates a second row while one is merely
    // suspended), and scoping this tightly to ACTIVE is what the
    // directive's literal wording asks for. See docs/modules/tenancy-
    // schema-design.md's "membership uniqueness strategy" for the
    // full rationale, including the deliberately-untested SUSPENDED edge.
    uniqueIndex("memberships_active_org_user_key")
      .on(table.organizationId, table.userId)
      .where(sqlInList(table.status, [MembershipStatus.Active])),
    // Plain, non-partial index over the same two columns — backs
    // findByUserId (all statuses), which the partial index above
    // (ACTIVE-only) can't serve; existsActive itself is served by the
    // partial index, since its query shape matches that index exactly.
    index("memberships_org_user_idx").on(table.organizationId, table.userId),
    check("memberships_role_check", sqlInList(table.role, MEMBERSHIP_ROLE_VALUES)),
    check("memberships_status_check", sqlInList(table.status, MEMBERSHIP_STATUS_VALUES)),
  ],
);
