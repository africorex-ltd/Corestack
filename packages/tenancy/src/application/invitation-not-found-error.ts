import { NotFoundError } from "@corestack/kernel";

/**
 * `acceptInvitation` (E05-T07)'s dedicated "no such invitation" rejection.
 * Extends the kernel's `NotFoundError` (`core/not_found`) rather than a new
 * top-level taxonomy code, but named and exported distinctly per Section 2.
 */
export class InvitationNotFoundError extends NotFoundError {
  constructor(invitationId: string) {
    super(`invitation "${invitationId}" not found`, { metadata: { invitationId } });
  }
}
