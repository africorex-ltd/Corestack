import type { OrgScopedContext } from "@corestack/platform";

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
 */
export interface InvitationRepository {
  findById(context: OrgScopedContext, invitationId: string): Promise<Invitation | null>;
  listForOrganization(context: OrgScopedContext): Promise<readonly Invitation[]>;
}
