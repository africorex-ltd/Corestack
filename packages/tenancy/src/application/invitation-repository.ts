import type { OrgScopedContext } from "@corestack/platform";

import type { InvitationRecord } from "../domain/invitation.js";

/**
 * Port only — no persistence implementation (E05-T21). Org-scoped like
 * `MembershipRepository` — every invitation belongs to exactly one
 * organization. `PreviewInvitation`'s public, unauthenticated lookup (by
 * raw token, not by org context) is deliberately not modeled here: that
 * lookup path is a genuinely different shape (no `OrgScopedContext`
 * exists yet at that point in the flow) and belongs to the command that
 * implements it (E05-T18), not this contract-only port.
 */
export interface InvitationRepository {
  findById(context: OrgScopedContext, invitationId: string): Promise<InvitationRecord | null>;
  listForOrganization(context: OrgScopedContext): Promise<readonly InvitationRecord[]>;
}
