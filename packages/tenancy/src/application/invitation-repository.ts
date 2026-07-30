import type { TransactionContext } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";

import type { Email } from "../domain/email.js";
import type { Invitation } from "../domain/invitation.js";

/**
 * Port only until E05-T11; now backed by `PostgresInvitationRepository`
 * as well as the in-memory reference. See
 * `docs/modules/tenancy-postgres-adapters.md` for the adapter's
 * transaction/mapper strategy. Org-scoped like `MembershipRepository` —
 * every invitation belongs to exactly one organization, no RLS open
 * question, no platform-role elevation needed. `PreviewInvitation`'s
 * public, unauthenticated lookup (by raw token, not by org context) is
 * deliberately not modeled here: that lookup path is a genuinely
 * different shape (no `OrgScopedContext` exists yet at that point in the
 * flow) and belongs to the command that implements it (E05-T18), not
 * this contract-only port — see `docs/modules/tenancy-rls-design.md`'s
 * "Future anonymous invitation acceptance" section for why that path
 * cannot simply reuse this port's app-role-scoped methods either.
 *
 * **Every method takes `tx: TransactionContext` as its first parameter**
 * (E05-T11) — see `organization-repository.ts`'s doc comment for the full
 * rationale (shared verbatim across all three tenancy repository ports).
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
  findById(
    tx: TransactionContext,
    context: OrgScopedContext,
    invitationId: string,
  ): Promise<Invitation | null>;
  listForOrganization(
    tx: TransactionContext,
    context: OrgScopedContext,
  ): Promise<readonly Invitation[]>;

  /**
   * Whether a `PENDING` invitation already exists for this email within
   * this organization. **Not a hard uniqueness guarantee** — like
   * `OrganizationRepository.existsBySlug`, this is a best-effort,
   * friendly-error check; `invitations_pending_org_email_key` (the real
   * unique constraint, E05-T10) plus `save`'s constraint-violation
   * translation into `InvitationAlreadyExistsError` is the actual
   * enforcement — nothing durable prevents two concurrent `inviteMember`
   * calls for the same email from both passing this check first.
   */
  existsPendingForEmail(
    tx: TransactionContext,
    context: OrgScopedContext,
    email: Email,
  ): Promise<boolean>;

  /** Persists a newly created (or subsequently modified) invitation. */
  save(tx: TransactionContext, context: OrgScopedContext, invitation: Invitation): Promise<void>;
}
