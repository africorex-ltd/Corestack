import { Membership } from "../../../domain/membership.js";
import type { MembershipRole } from "../../../domain/membership-role.js";
import type { MembershipStatus } from "../../../domain/membership-status.js";

/** Raw `tenancy.memberships` row shape — see `organization-mapper.ts`'s doc comment for the querying convention this follows. */
export interface MembershipRow {
  readonly id: string;
  readonly organization_id: string;
  readonly user_id: string;
  readonly role: string;
  readonly status: string;
  readonly joined_at: Date;
  readonly updated_at: Date;
  readonly removed_at: Date | null;
}

/**
 * Row → aggregate (E05-T11 Section 7). `role`/`status` are trusted as
 * their respective enums without re-validation — `memberships_role_check`/
 * `memberships_status_check` (E05-T09) already guarantee legal values.
 */
export function toMembership(row: MembershipRow): Membership {
  return Membership.reconstitute({
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role as MembershipRole,
    status: row.status as MembershipStatus,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
    removedAt: row.removed_at,
  });
}

/** Plain values for an `INSERT`/`UPDATE` — the aggregate → row direction. */
export interface MembershipRowValues {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: MembershipRole;
  readonly status: MembershipStatus;
  readonly joinedAt: Date;
  readonly updatedAt: Date;
  readonly removedAt: Date | null;
}

/** Aggregate → row (E05-T11 Section 7) — the exact inverse of `toMembership`. */
export function toMembershipRow(membership: Membership): MembershipRowValues {
  return {
    id: membership.id.value,
    organizationId: membership.organizationId.value,
    userId: membership.userId.value,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt,
    updatedAt: membership.updatedAt,
    removedAt: membership.removedAt,
  };
}
