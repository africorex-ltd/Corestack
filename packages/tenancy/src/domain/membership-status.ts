/**
 * Membership lifecycle status — E05-T04 Section 5.
 */
export const MembershipStatus = {
  Active: "ACTIVE",
  Suspended: "SUSPENDED",
  Removed: "REMOVED",
} as const;

export type MembershipStatus = (typeof MembershipStatus)[keyof typeof MembershipStatus];

/**
 * Legal transitions (E05-T04 Section 5) — structurally identical to
 * `OrganizationStatus`'s table (E05-T02): `REMOVED` has no outgoing
 * entries and is terminal (every transition attempted *from* `REMOVED` is
 * illegal, including back to `ACTIVE`), and there are deliberately no
 * self-transitions — calling `suspend()` on an already-suspended
 * membership is an invalid transition, not a no-op (Section 8).
 */
const LEGAL_TRANSITIONS: Readonly<Record<MembershipStatus, readonly MembershipStatus[]>> = {
  [MembershipStatus.Active]: [MembershipStatus.Suspended, MembershipStatus.Removed],
  [MembershipStatus.Suspended]: [MembershipStatus.Active, MembershipStatus.Removed],
  [MembershipStatus.Removed]: [],
};

export function isLegalMembershipStatusTransition(
  from: MembershipStatus,
  to: MembershipStatus,
): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}
