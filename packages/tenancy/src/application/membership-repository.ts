import type { OrgScopedContext } from "@corestack/platform";

import type { MembershipRecord } from "../domain/membership.js";

/**
 * Port only — no persistence implementation (E05-T21). Unlike
 * `OrganizationRepository`, memberships are unambiguously org-scoped rows
 * (`organization_id` on every row), so the standard `OrgScopedContext`
 * pattern applies directly with no open question.
 */
export interface MembershipRepository {
  findById(context: OrgScopedContext, membershipId: string): Promise<MembershipRecord | null>;
  listForOrganization(context: OrgScopedContext): Promise<readonly MembershipRecord[]>;
}
