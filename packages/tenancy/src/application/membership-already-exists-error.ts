import { ConflictError } from "@corestack/kernel";

/**
 * `acceptInvitation` (E05-T07)'s rejection when the accepting user already
 * has an `ACTIVE` membership in the organization (Section 5 step 3). On
 * this path: no `Membership` is constructed, the invitation is left
 * untouched (neither accepted nor expired), and no event is published —
 * the same "no mutation on the rejected path" shape
 * `InvitationAlreadyExistsError` (E05-T06) already established for
 * `inviteMember`'s own duplicate check.
 *
 * Extends the kernel's `ConflictError` (`core/conflict`) rather than a new
 * top-level taxonomy code, but named and exported distinctly per Section 2.
 */
export class MembershipAlreadyExistsError extends ConflictError {
  constructor(userId: string, organizationId: string) {
    super(`user "${userId}" already has an active membership in this organization`, {
      metadata: { userId, organizationId },
    });
  }
}
