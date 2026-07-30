import type { TransactionContext } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";

import type { Membership } from "../domain/membership.js";

/**
 * Port only until E05-T11; now backed by `PostgresMembershipRepository`
 * as well as the in-memory reference. See
 * `docs/modules/tenancy-postgres-adapters.md` for the adapter's
 * transaction/mapper strategy. Unlike `OrganizationRepository`,
 * memberships are unambiguously org-scoped rows (`organization_id` on
 * every row), so the standard `OrgScopedContext` pattern applies
 * directly with no RLS open question — every method here runs as the
 * plain `tenancy_app` role, scoped by `app.current_org` (already set by
 * the enclosing `UnitOfWork` from `context.organizationId`), no platform-
 * role elevation needed.
 *
 * **Every method takes `tx: TransactionContext` as its first parameter**
 * (E05-T11) — see `organization-repository.ts`'s doc comment for the full
 * rationale (shared verbatim across all three tenancy repository ports).
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
 * **No separate `findByOrganizationAndUser` method** (E05-T11, despite
 * the founder directive's Section 5 wording): `findByUserId(context,
 * userId)` already *is* "find by organization and user," since
 * `context.organizationId` supplies the organization half — T08 already
 * declined to duplicate it for the same reason, and nothing since has
 * changed.
 */
export interface MembershipRepository {
  findById(
    tx: TransactionContext,
    context: OrgScopedContext,
    membershipId: string,
  ): Promise<Membership | null>;
  listForOrganization(
    tx: TransactionContext,
    context: OrgScopedContext,
  ): Promise<readonly Membership[]>;

  /**
   * This user's membership within the organization identified by
   * `context`, regardless of status — the caller decides what to do with
   * a `SUSPENDED`/`REMOVED` result (e.g. `inviteMember`'s authorization
   * check requires `ACTIVE`, checked by the caller, not filtered here).
   */
  findByUserId(
    tx: TransactionContext,
    context: OrgScopedContext,
    userId: string,
  ): Promise<Membership | null>;

  /** Whether this user already has an `ACTIVE` membership in this organization. Used by `acceptInvitation` to reject a duplicate admission before creating a second `Membership` for the same user. */
  existsActive(tx: TransactionContext, context: OrgScopedContext, userId: string): Promise<boolean>;

  /** Persists a newly created (or subsequently modified) membership. */
  save(tx: TransactionContext, context: OrgScopedContext, membership: Membership): Promise<void>;
}
