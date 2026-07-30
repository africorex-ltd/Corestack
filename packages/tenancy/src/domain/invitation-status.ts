/**
 * Invitation lifecycle status — E05-T05 Section 5.
 */
export const InvitationStatus = {
  Pending: "PENDING",
  Accepted: "ACCEPTED",
  Revoked: "REVOKED",
  Expired: "EXPIRED",
} as const;

export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];

/**
 * Legal transitions (E05-T05 Section 5). `PENDING` is the only mutable
 * state — it has three legal outgoing transitions, one per terminal
 * method (`accept`/`revoke`/`expire`). `ACCEPTED`, `REVOKED`, and
 * `EXPIRED` each have an empty outgoing list: all three are terminal, and
 * — unlike `OrganizationStatus`/`MembershipStatus`, which each have a
 * single terminal state — here there are three, none of which transition
 * to any other, including back to `PENDING` or to each other.
 */
const LEGAL_TRANSITIONS: Readonly<Record<InvitationStatus, readonly InvitationStatus[]>> = {
  [InvitationStatus.Pending]: [
    InvitationStatus.Accepted,
    InvitationStatus.Revoked,
    InvitationStatus.Expired,
  ],
  [InvitationStatus.Accepted]: [],
  [InvitationStatus.Revoked]: [],
  [InvitationStatus.Expired]: [],
};

export function isLegalInvitationStatusTransition(
  from: InvitationStatus,
  to: InvitationStatus,
): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}
