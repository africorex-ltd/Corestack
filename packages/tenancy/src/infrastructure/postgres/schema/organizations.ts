import { check, index, timestamp, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { OrganizationStatus } from "../../../domain/organization-status.js";
import { tenancySchema } from "./tenancy-pg-schema.js";
import { sqlInList } from "./sql-in-list.js";

const ORGANIZATION_STATUS_VALUES = [
  OrganizationStatus.Active,
  OrganizationStatus.Suspended,
  OrganizationStatus.Deleted,
] as const;

/**
 * `tenancy.organizations` — E05-T09 Section 4. Column set and terminal-
 * state shape follow the *implemented* `Organization` aggregate
 * (E05-T02), not `tenancy-contract.md`'s forward-looking 4-state/`kind`
 * blueprint (E05-T09's directive: "do not resolve the 3-state vs 4-state
 * reconciliation here; use the implemented domain model" — see that
 * aggregate's own non-goals for the open reconciliation this defers).
 *
 * No `version` column: the aggregate carries no optimistic-concurrency
 * counter today (see `docs/modules/tenancy-schema-design.md`'s
 * "concurrency expectations" section for what protects against races in
 * its absence, and what doesn't yet).
 *
 * **RLS attachment point (E05-T10, not implemented here — Section 11):**
 * this table is the one case `OrganizationRepository`'s own port doc
 * already flags as open — a row here *is* an organization, not something
 * merely scoped *to* one, so the standard `buildTenantIsolationDdl`
 * `organization_id = current_setting('app.current_org')::uuid` policy
 * (`@corestack/platform`'s `tenant-policy.ts`, E03-T30) does not apply
 * verbatim. E05-T10 must decide between (a) keying the policy off `id`
 * directly instead of `organization_id`, or (b) a membership-join
 * condition allowing any active member to read their own organization's
 * row. See `docs/modules/tenancy-schema-design.md`'s "RLS attachment
 * points" section.
 */
export const organizations = tenancySchema.table(
  "organizations",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ORGANIZATION_STATUS_VALUES }).notNull(),
    // No DB-side default: the aggregate always supplies `createdAt`
    // itself, and that instant must match the same `occurredAt` already
    // published on `OrganizationCreated` — a DB-computed `now()` fallback
    // could silently desynchronize the two if a future insert path ever
    // omitted this column (see tenancy-persistence-mapping.md rule 3).
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Plain (non-partial) unique constraint — unlike DATABASE.md §5's
    // blueprint `PUX slug WHERE status <> 'purged'`, the implemented
    // 3-state model has no terminal "purged" state to free a slug for
    // reuse; a `DELETED` organization's slug stays taken. Revisit if/when
    // the 4-state reconciliation lands (see docs/modules/organization-
    // domain.md's non-goals).
    uniqueIndex("organizations_slug_key").on(table.slug),
    index("organizations_status_idx").on(table.status),
    check("organizations_status_check", sqlInList(table.status, ORGANIZATION_STATUS_VALUES)),
  ],
);
