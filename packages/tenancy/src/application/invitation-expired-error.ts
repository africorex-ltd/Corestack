import { ConflictError } from "@corestack/kernel";

/**
 * `acceptInvitation` (E05-T07)'s rejection when `now >= invitation.expiresAt`
 * at acceptance time (Section 7) — even though the invitation was still
 * `PENDING` in storage. This is the enforcement point that closes the gap
 * E05-T05 documented explicitly: `Invitation.expire()` never compares `now`
 * against `expiresAt` itself, so *something* has to. This use case is that
 * something. By the time this error is returned, the invitation has already
 * been transitioned to `EXPIRED` and persisted — the error reports a fact
 * that already happened, not a precondition check that left state
 * untouched.
 *
 * Extends the kernel's `ConflictError` (`core/conflict` — "the operation
 * conflicts with current state") rather than a new top-level taxonomy code,
 * but named and exported distinctly per Section 2.
 */
export class InvitationExpiredError extends ConflictError {
  constructor(invitationId: string, expiresAt: Date) {
    super(`invitation "${invitationId}" expired at ${expiresAt.toISOString()}`, {
      metadata: { invitationId, expiresAt: expiresAt.toISOString() },
    });
  }
}
