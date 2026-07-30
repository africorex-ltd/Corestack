import { ConflictError } from "@corestack/kernel";

/**
 * `inviteMember` (E05-T06)'s duplicate-invitation rejection: a `PENDING`
 * invitation already exists for this email within this organization.
 *
 * Extends the kernel's `ConflictError` (same `core/conflict` taxonomy
 * code) rather than introducing a new top-level error class, but is
 * named and exported distinctly per this task's explicit instruction —
 * the same shape `DuplicateSlugError` (E05-T03) established.
 */
export class InvitationAlreadyExistsError extends ConflictError {
  constructor(email: string, organizationId: string) {
    super(`a pending invitation for "${email}" already exists in this organization`, {
      metadata: { email, organizationId },
    });
  }
}
