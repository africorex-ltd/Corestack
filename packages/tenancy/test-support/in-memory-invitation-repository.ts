import type { OrgScopedContext } from "@corestack/platform";

import { InvitationStatus } from "../src/domain/invitation-status.js";
import type { Email } from "../src/domain/email.js";
import type { Invitation } from "../src/domain/invitation.js";
import type { InvitationRepository } from "../src/application/invitation-repository.js";

/**
 * In-memory `InvitationRepository` (E05-T08). Copy-on-write storage, same
 * rationale as `InMemoryOrganizationRepository`.
 *
 * No `findPendingById` method — matching the port itself (E05-T07
 * deliberately did not add one; see `invitation-repository.ts`'s own
 * comment). `findById` returns an invitation regardless of status, which
 * is exactly what `acceptInvitation` needs to distinguish "not found"
 * from "not pending."
 */
export class InMemoryInvitationRepository implements InvitationRepository {
  #invitations: ReadonlyMap<string, Invitation> = new Map();

  async findById(_context: OrgScopedContext, invitationId: string): Promise<Invitation | null> {
    return this.#invitations.get(invitationId) ?? null;
  }

  async listForOrganization(context: OrgScopedContext): Promise<readonly Invitation[]> {
    return [...this.#invitations.values()].filter(
      (invitation) => invitation.organizationId.value === context.organizationId,
    );
  }

  async existsPendingForEmail(context: OrgScopedContext, email: Email): Promise<boolean> {
    return [...this.#invitations.values()].some(
      (invitation) =>
        invitation.organizationId.value === context.organizationId &&
        invitation.status === InvitationStatus.Pending &&
        invitation.email.equals(email),
    );
  }

  async save(_context: OrgScopedContext, invitation: Invitation): Promise<void> {
    this.#invitations = new Map(this.#invitations).set(invitation.id.value, invitation);
  }
}
