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
 *
 * `findByUserId`/`existsActive`/`save` added in E05-T06's follow-up task
 * (E05-T07) for `inviteMember`'s inviter-authorization check and
 * `acceptInvitation`'s duplicate-membership check/membership persistence —
 * the same "necessary repository interaction, not a full adapter" shape
 * `existsBySlug`/`save` were for `OrganizationRepository` in E05-T03.
 */
export interface MembershipRepository {
  findById(context: OrgScopedContext, membershipId: string): Promise<Membership | null>;
  listForOrganization(context: OrgScopedContext): Promise<readonly Membership[]>;

  /**
   * This user's membership within the organization identified by
   * `context`, regardless of status — the caller decides what to do with
   * a `SUSPENDED`/`REMOVED` result (e.g. `inviteMember`'s authorization
   * check requires `ACTIVE`, checked by the caller, not filtered here).
   */
  findByUserId(context: OrgScopedContext, userId: string): Promise<Membership | null>;

  /** Whether this user already has an `ACTIVE` membership in this organization. Used by `acceptInvitation` to reject a duplicate admission before creating a second `Membership` for the same user. */
  existsActive(context: OrgScopedContext, userId: string): Promise<boolean>;

  /** Persists a newly created (or subsequently modified) membership. */
  save(context: OrgScopedContext, membership: Membership): Promise<void>;
}
