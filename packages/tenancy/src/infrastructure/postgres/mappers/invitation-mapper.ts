import { Invitation } from "../../../domain/invitation.js";
import type { InvitationRole } from "../../../domain/invitation-role.js";
import type { InvitationStatus } from "../../../domain/invitation-status.js";

/** Raw `tenancy.invitations` row shape — see `organization-mapper.ts`'s doc comment for the querying convention this follows. */
export interface InvitationRow {
  readonly id: string;
  readonly organization_id: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly invited_by: string;
  readonly created_at: Date;
  readonly expires_at: Date;
  readonly responded_at: Date | null;
}

/**
 * Row → aggregate (E05-T11 Section 7). `role`/`status` are trusted as
 * their respective enums without re-validation —
 * `invitations_role_check`/`invitations_status_check` (E05-T09) already
 * guarantee legal values. `email` is trusted as already-normalized
 * (lowercased/trimmed) — the row was only ever written by `Email.from`'s
 * own normalization at creation time (E05-T05); `Invitation.reconstitute`
 * still passes it through `Email.from` for parity of representation, not
 * because the row might disagree.
 */
export function toInvitation(row: InvitationRow): Invitation {
  return Invitation.reconstitute({
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role as InvitationRole,
    status: row.status as InvitationStatus,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    respondedAt: row.responded_at,
  });
}

/** Plain values for an `INSERT`/`UPDATE` — the aggregate → row direction. */
export interface InvitationRowValues {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: InvitationRole;
  readonly status: InvitationStatus;
  readonly invitedBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly respondedAt: Date | null;
}

/** Aggregate → row (E05-T11 Section 7) — the exact inverse of `toInvitation`. */
export function toInvitationRow(invitation: Invitation): InvitationRowValues {
  return {
    id: invitation.id.value,
    organizationId: invitation.organizationId.value,
    email: invitation.email.value,
    role: invitation.role,
    status: invitation.status,
    invitedBy: invitation.invitedBy.value,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    respondedAt: invitation.respondedAt,
  };
}
