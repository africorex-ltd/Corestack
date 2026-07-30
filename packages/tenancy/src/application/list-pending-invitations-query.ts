import type { UnitOfWork } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";

import type { Invitation } from "../domain/invitation.js";
import type { InvitationRole } from "../domain/invitation-role.js";
import { InvitationStatus } from "../domain/invitation-status.js";
import type { InvitationRepository } from "./invitation-repository.js";

/**
 * A DTO, not the aggregate (Section 3). No `status` field — every row
 * this query returns is `PENDING` by construction (filtered before
 * mapping), so a status field would be constant and uninformative; a
 * caller that needs to distinguish terminal states has no use for this
 * query at all (see `list-pending-invitations-query.ts`'s own doc
 * comment on why non-pending invitations are excluded, not merely
 * flagged).
 */
export interface PendingInvitationSummary {
  readonly id: string;
  readonly email: string;
  readonly role: InvitationRole;
  readonly invitedBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/** Explicit aggregate-to-DTO mapper (Section 7). Assumes `invitation.status === PENDING` — enforced by the caller's filter, not re-checked here. */
export function toPendingInvitationSummary(invitation: Invitation): PendingInvitationSummary {
  return {
    id: invitation.id.value,
    email: invitation.email.value,
    role: invitation.role,
    invitedBy: invitation.invitedBy.value,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
  };
}

export interface ListPendingInvitationsDeps {
  readonly uow: UnitOfWork;
  readonly repository: InvitationRepository;
}

/**
 * `ListPendingInvitationsQuery` (E05-T12) — `context`'s organization's
 * `PENDING` invitations only (Section 6: "exclude non-pending
 * invitations") — `ACCEPTED`/`REVOKED`/`EXPIRED` rows are filtered out
 * here, in the query, not by adding a new repository method: `E05-T07`
 * already declined to add a `findPendingById`-shaped method to
 * `InvitationRepository` for the same reason (see that port's own doc
 * comment) — a filter belongs to the application layer, not the
 * persistence port (Section 2/11: "query shape owned by the application
 * layer"). Sorted by `createdAt` ascending (Section 6).
 */
export async function listPendingInvitations(
  context: OrgScopedContext,
  deps: ListPendingInvitationsDeps,
): Promise<readonly PendingInvitationSummary[]> {
  return deps.uow.run(async (tx) => {
    const invitations = await deps.repository.listForOrganization(tx, context);
    return invitations
      .filter((invitation) => invitation.status === InvitationStatus.Pending)
      .map(toPendingInvitationSummary)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  });
}
