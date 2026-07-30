/**
 * Membership role — E05-T04 Section 4.
 */
export const MembershipRole = {
  Owner: "OWNER",
  Admin: "ADMIN",
  Member: "MEMBER",
} as const;

export type MembershipRole = (typeof MembershipRole)[keyof typeof MembershipRole];

/**
 * Legal role transitions through this aggregate (E05-T04 Section 4).
 *
 * `OWNER` has no outgoing entries: it cannot be downgraded to `ADMIN`/
 * `MEMBER` and cannot be removed (the latter is enforced separately in
 * `Membership.remove`, since removal is a status change, not a role
 * change). This is a **structural lock** in this aggregate, not a
 * lifecycle terminal state the way `OrganizationStatus.Deleted` or
 * `MembershipStatus.Removed` are — an owner's role can still change via a
 * *future*, separate ownership-transfer use case (Section 15) that this
 * aggregate deliberately does not implement.
 *
 * There are no self-transitions (`ADMIN` → `ADMIN`, etc.): Section 8
 * allows self-transition no-ops only where explicitly documented, and none
 * are documented for roles — calling `promoteToAdmin` on an existing admin
 * is an invalid transition, not a no-op.
 */
const LEGAL_ROLE_TRANSITIONS: Readonly<Record<MembershipRole, readonly MembershipRole[]>> = {
  [MembershipRole.Owner]: [],
  [MembershipRole.Admin]: [MembershipRole.Member],
  [MembershipRole.Member]: [MembershipRole.Admin],
};

export function isLegalMembershipRoleTransition(
  from: MembershipRole,
  to: MembershipRole,
): boolean {
  return LEGAL_ROLE_TRANSITIONS[from].includes(to);
}
