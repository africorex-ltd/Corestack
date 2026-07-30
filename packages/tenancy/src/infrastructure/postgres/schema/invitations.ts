import { check, index, timestamp, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { InvitationRole } from "../../../domain/invitation-role.js";
import { InvitationStatus } from "../../../domain/invitation-status.js";
import { organizations } from "./organizations.js";
import { tenancySchema } from "./tenancy-pg-schema.js";
import { sqlInList } from "./sql-in-list.js";

const INVITATION_ROLE_VALUES = [InvitationRole.Admin, InvitationRole.Member] as const;

const INVITATION_STATUS_VALUES = [
  InvitationStatus.Pending,
  InvitationStatus.Accepted,
  InvitationStatus.Revoked,
  InvitationStatus.Expired,
] as const;

/**
 * `tenancy.invitations` — E05-T09 Section 6. Column set matches the
 * implemented `Invitation` aggregate (E05-T05) exactly, including its
 * absence of a `respondedAt`-adjacent `updatedAt` (there isn't one — see
 * the aggregate's own `#assertMonotonic` comment) and, deliberately,
 * **no `token_hash` column**: `tenancy-contract.md`/DATABASE.md §5's
 * blueprint shape assumes invitation-token generation and hashing, which
 * the domain model does not implement (a repeatedly-flagged non-goal
 * since E05-T05; see `docs/modules/invitation-domain.md`'s own non-goals
 * section for why).
 *
 * `role` is restricted to `ADMIN`/`MEMBER` (two values, not three) —
 * `InvitationRole` structurally excludes `OWNER` in the domain layer
 * already; the `CHECK` constraint below is the same restriction enforced
 * a second time at the database boundary.
 *
 * **Email normalization (Section 6):** happens once, at the `Email`
 * value object's construction (`Email.from` trims and lowercases before
 * validating) — by the time a row reaches this table, `email` is
 * guaranteed already-normalized. The column is plain `text` with a plain
 * (not `lower(...)`-expression) unique index, matching DATABASE.md §1
 * rule 9's "stored lowercased... not `citext`" — normalization is the
 * application's job, not the database's.
 *
 * `invited_by` has no foreign key — same by-id, cross-module reference
 * rationale as `memberships.user_id`.
 *
 * **RLS attachment point (E05-T10, not implemented here — Section 11):**
 * org-scoped like `memberships` — the standard `buildTenantIsolationDdl`
 * policy attaches with no open question.
 */
export const invitations = tenancySchema.table(
  "invitations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: INVITATION_ROLE_VALUES }).notNull(),
    status: text("status", { enum: INVITATION_STATUS_VALUES }).notNull(),
    invitedBy: uuid("invited_by").notNull(),
    // No DB-side default — same rationale as organizations.created_at:
    // the aggregate always supplies this instant, matching the
    // `InvitationCreated` event's own `occurredAt`.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [
    // Partial unique index — one PENDING invitation per (organization,
    // email); history rows (ACCEPTED/REVOKED/EXPIRED) remain and are
    // deliberately excluded from the uniqueness scope, mirroring
    // DATABASE.md §5's own `invitations` design exactly.
    uniqueIndex("invitations_pending_org_email_key")
      .on(table.organizationId, table.email)
      .where(sqlInList(table.status, [InvitationStatus.Pending])),
    // Supports listForOrganization (all statuses) — the partial index
    // above only covers the PENDING subset.
    index("invitations_organization_idx").on(table.organizationId),
    check("invitations_role_check", sqlInList(table.role, INVITATION_ROLE_VALUES)),
    check("invitations_status_check", sqlInList(table.status, INVITATION_STATUS_VALUES)),
  ],
);
