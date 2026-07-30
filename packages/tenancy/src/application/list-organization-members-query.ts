import type { UnitOfWork } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";

import type { Membership } from "../domain/membership.js";
import type { MembershipRole } from "../domain/membership-role.js";
import type { MembershipStatus } from "../domain/membership-status.js";
import type { MembershipRepository } from "./membership-repository.js";

/**
 * A DTO, not the aggregate (Section 3). **Deliberately excludes
 * `removedAt`** (Section 5: "Do not expose removedAt") — a `REMOVED`
 * member's removal instant is not this query's business, even though the
 * `status` field alone already tells a caller a membership is `REMOVED`.
 */
export interface OrganizationMemberSummary {
  readonly id: string;
  readonly userId: string;
  readonly role: MembershipRole;
  readonly status: MembershipStatus;
  readonly joinedAt: Date;
}

/** Explicit aggregate-to-DTO mapper (Section 7). */
export function toOrganizationMemberSummary(membership: Membership): OrganizationMemberSummary {
  return {
    id: membership.id.value,
    userId: membership.userId.value,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt,
  };
}

export interface ListOrganizationMembersDeps {
  readonly uow: UnitOfWork;
  readonly repository: MembershipRepository;
}

/**
 * `ListOrganizationMembersQuery` (E05-T12) — every membership belonging
 * to `context`'s organization (any status: `ACTIVE`/`SUSPENDED`/
 * `REMOVED` — Section 5 does not ask for status filtering, unlike
 * `ListPendingInvitationsQuery`'s explicit `PENDING`-only filter), sorted
 * by `joinedAt` ascending (Section 5). No new repository method — reuses
 * `MembershipRepository.listForOrganization` unchanged since E05-T04/T11,
 * which is already fully org-scoped via RLS (Section 2/3).
 */
export async function listOrganizationMembers(
  context: OrgScopedContext,
  deps: ListOrganizationMembersDeps,
): Promise<readonly OrganizationMemberSummary[]> {
  return deps.uow.run(async (tx) => {
    const memberships = await deps.repository.listForOrganization(tx, context);
    return memberships
      .map(toOrganizationMemberSummary)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  });
}
