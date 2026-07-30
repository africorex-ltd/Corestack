import type { OrgScopedContext } from "@corestack/platform";

import type { Email } from "../domain/email.js";
import type { Invitation } from "../domain/invitation.js";

/**
 * Port only — no persistence implementation (E05-T21). Org-scoped like
 * `MembershipRepository` — every invitation belongs to exactly one
 * organization. `PreviewInvitation`'s public, unauthenticated lookup (by
 * raw token, not by org context) is deliberately not modeled here: that
 * lookup path is a genuinely different shape (no `OrgScopedContext`
 * exists yet at that point in the flow) and belongs to the command that
 * implements it (E05-T18), not this contract-only port.
 *
 * Signatures updated in E05-T05 to return the real `Invitation` aggregate
 * instead of the superseded `InvitationRecord` placeholder — the same
 * forced, mechanical fix `OrganizationRepository`/`MembershipRepository`
 * went through in E05-T02/T04.
 *
 * `existsPendingForEmail`/`save` added in E05-T06 for `inviteMember` —
 * the same "necessary repository interaction, not a full adapter"
 * addition `existsBySlug`/`save` were for `OrganizationRepository` in
 * E05-T03.
 *
 * **E05-T07 deliberately does not add a `findPendingById` method**, even
 * though the founder directive suggested one: `acceptInvitation` needs to
 * distinguish `InvitationNotFoundError` (no such invitation) from
 * `InvitationNotPendingError` (invitation exists, but is `ACCEPTED`/
 * `REVOKED`/already `EXPIRED`) — two different error types Section 2
 * requires as separate exports. A method that pre-filters to `PENDING`
 * only (returning `null` for both "doesn't exist" and "exists but not
 * pending") would make those two cases indistinguishable from inside the
 * use case. The existing `findById` above already returns the invitation
 * regardless of status, which is exactly what's needed — `acceptInvitation`
 * inspects `.status` itself. Nothing was added to this port for E05-T07.
 */
export interface InvitationRepository {
  findById(context: OrgScopedContext, invitationId: string): Promise<Invitation | null>;
  listForOrganization(context: OrgScopedContext): Promise<readonly Invitation[]>;

  /**
   * Whether a `PENDING` invitation already exists for this email within
   * this organization. **Not a hard uniqueness guarantee** — like
   * `OrganizationRepository.existsBySlug`, this is a best-effort,
   * friendly-error check until E05-T21 adds a real uniqueness constraint;
   * nothing durable yet prevents two concurrent `inviteMember` calls for
   * the same email from both passing it.
   */
  existsPendingForEmail(context: OrgScopedContext, email: Email): Promise<boolean>;

  /** Persists a newly created (or subsequently modified) invitation. */
  save(context: OrgScopedContext, invitation: Invitation): Promise<void>;
}
