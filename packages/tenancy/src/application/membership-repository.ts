import type { OrgScopedContext } from "@corestack/platform";

import type { Membership } from "../domain/membership.js";

/**
 * Port only — no persistence implementation (E05-T21). Unlike
 * `OrganizationRepository`, memberships are unambiguously org-scoped rows
 * (`organization_id` on every row), so the standard `OrgScopedContext`
 * pattern applies directly with no open question.
 *
 * Signatures updated in E05-T04 to return the real `Membership` aggregate
 * instead of the superseded `MembershipRecord` placeholder — the same
 * forced, mechanical fix `OrganizationRepository` went through in E05-T02.
 */
export interface MembershipRepository {
  findById(context: OrgScopedContext, membershipId: string): Promise<Membership | null>;
  listForOrganization(context: OrgScopedContext): Promise<readonly Membership[]>;
}
