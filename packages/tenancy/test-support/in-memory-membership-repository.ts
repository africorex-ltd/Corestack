import type { TransactionContext } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";

import { MembershipStatus } from "../src/domain/membership-status.js";
import type { Membership } from "../src/domain/membership.js";
import type { MembershipRepository } from "../src/application/membership-repository.js";

function userKey(organizationId: string, userId: string): string {
  return `${organizationId}:${userId}`;
}

/**
 * In-memory `MembershipRepository` (E05-T08). Copy-on-write storage, same
 * rationale as `InMemoryOrganizationRepository`.
 *
 * **Simplification**: the `organizationId:userId` index holds at most one
 * membership id per user per organization (last `save` wins). A user
 * could, in principle, accumulate more than one `Membership` row over
 * time (one `REMOVED`, a later one `ACTIVE`, from being invited again
 * after removal) — no test scenario in this task's workflow exercises
 * that, and no production data-model decision has settled it either.
 * `findByUserId` therefore answers "this user's *current* membership,"
 * not "every membership this user has ever had here."
 */
export class InMemoryMembershipRepository implements MembershipRepository {
  #memberships: ReadonlyMap<string, Membership> = new Map();
  #byUser: ReadonlyMap<string, string> = new Map();

  async findById(
    _tx: TransactionContext,
    _context: OrgScopedContext,
    membershipId: string,
  ): Promise<Membership | null> {
    return this.#memberships.get(membershipId) ?? null;
  }

  async listForOrganization(
    _tx: TransactionContext,
    context: OrgScopedContext,
  ): Promise<readonly Membership[]> {
    return [...this.#memberships.values()].filter(
      (membership) => membership.organizationId.value === context.organizationId,
    );
  }

  async findByUserId(
    _tx: TransactionContext,
    context: OrgScopedContext,
    userId: string,
  ): Promise<Membership | null> {
    const membershipId = this.#byUser.get(userKey(context.organizationId, userId));
    return membershipId === undefined ? null : this.#memberships.get(membershipId) ?? null;
  }

  async existsActive(
    tx: TransactionContext,
    context: OrgScopedContext,
    userId: string,
  ): Promise<boolean> {
    const membership = await this.findByUserId(tx, context, userId);
    return membership !== null && membership.status === MembershipStatus.Active;
  }

  async save(
    _tx: TransactionContext,
    _context: OrgScopedContext,
    membership: Membership,
  ): Promise<void> {
    this.#memberships = new Map(this.#memberships).set(membership.id.value, membership);
    this.#byUser = new Map(this.#byUser).set(
      userKey(membership.organizationId.value, membership.userId.value),
      membership.id.value,
    );
  }
}
