import { ForbiddenError } from "@corestack/kernel";

/**
 * `inviteMember` (E05-T07 Section 8)'s rejection when the inviter is not
 * permitted to invite at the requested role — either because they have no
 * `ACTIVE` membership in the organization at all, or because their role
 * doesn't authorize inviting the requested target role (see
 * `invite-authorization.ts`'s `canInviteAs` matrix: only `OWNER`/`ADMIN`
 * can invite, `ADMIN` cannot invite `ADMIN`, nobody can invite `OWNER`).
 *
 * Despite the name, this is consumed by `inviteMember`, not
 * `acceptInvitation` — Section 2 lists it alongside `acceptInvitation`'s
 * own error types because it is implemented in this same task, not because
 * it belongs to that use case's vocabulary.
 *
 * Extends the kernel's `ForbiddenError` (`core/forbidden` — "authenticated
 * but not permitted") rather than a new top-level taxonomy code, but named
 * and exported distinctly per Section 2.
 */
export class InviterNotAuthorizedError extends ForbiddenError {
  constructor(invitedBy: string, organizationId: string, targetRole: string) {
    super(
      `user "${invitedBy}" is not authorized to invite a member as ${targetRole} in this organization`,
      { metadata: { invitedBy, organizationId, targetRole } },
    );
  }
}
