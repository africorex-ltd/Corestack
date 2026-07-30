import { MembershipRole } from "../domain/membership-role.js";

/**
 * The minimum authorization rule for invitation creation (E05-T07 Section
 * 3/8): "inviter must have OWNER or ADMIN membership in the organization,"
 * refined into a per-target-role matrix so `ADMIN` can invite `MEMBER` but
 * not another `ADMIN`.
 *
 * `targetRole` is typed as `MembershipRole` (not the narrower
 * `InvitationRole`, which excludes `OWNER` entirely) so this function is
 * independently exhaustive over all three roles — including the "nobody
 * can invite OWNER" case Section 8 asks to test explicitly — rather than
 * only ever being exercised with the two values `inviteMember` can
 * actually pass it (`inviteMember` itself already rejects `role: "OWNER"`
 * before this function is ever called, via `CannotInviteOwnerError` —
 * E05-T06 — so this function's own `OWNER` rejection is defense-in-depth
 * for any other caller, the same relationship `CannotInviteOwnerError` has
 * with `Invitation.create`'s `assertValidInvitationRole`).
 *
 * A `MEMBER` inviter is authorized to invite no one — Section 8 only
 * grants invite permission to `OWNER`/`ADMIN`; the absence of a `MEMBER`
 * row in the matrix is a deliberate secure-by-default denial, not an
 * oversight.
 */
export function canInviteAs(inviterRole: MembershipRole, targetRole: MembershipRole): boolean {
  if (targetRole === MembershipRole.Owner) return false;

  switch (inviterRole) {
    case MembershipRole.Owner:
      return true;
    case MembershipRole.Admin:
      return targetRole === MembershipRole.Member;
    case MembershipRole.Member:
      return false;
  }
}
