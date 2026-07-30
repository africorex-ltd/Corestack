import { ConflictError } from "@corestack/kernel";

import type { InvitationStatus } from "../domain/invitation-status.js";

/**
 * `acceptInvitation` (E05-T07)'s rejection when an invitation exists but is
 * not `PENDING` — already `ACCEPTED`, already `REVOKED`, or already
 * `EXPIRED` in storage (as opposed to newly-discovered-expired at
 * acceptance time, which is `InvitationExpiredError`'s job). Kept distinct
 * from `InvitationNotFoundError` deliberately — see
 * `invitation-repository.ts`'s comment on why `findById` (not a
 * pending-filtered lookup) is used to look the invitation up in the first
 * place.
 *
 * Extends the kernel's `ConflictError` (`core/conflict`) rather than a new
 * top-level taxonomy code, but named and exported distinctly per Section 2.
 */
export class InvitationNotPendingError extends ConflictError {
  constructor(invitationId: string, status: InvitationStatus) {
    super(`invitation "${invitationId}" is not PENDING (status: ${status})`, {
      metadata: { invitationId, status },
    });
  }
}
