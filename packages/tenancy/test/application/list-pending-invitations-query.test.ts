import { describe, expect, it } from "vitest";
import { InMemoryEventBus, InMemoryUnitOfWork, createContext, UuidGenerator } from "@corestack/kernel";
import { requireOrgScoped, type OrgScopedContext } from "@corestack/platform";

import { Invitation } from "../../src/domain/invitation.js";
import { InvitationRole } from "../../src/domain/invitation-role.js";
import {
  listPendingInvitations,
  toPendingInvitationSummary,
} from "../../src/application/list-pending-invitations-query.js";
import { InMemoryInvitationRepository } from "../../test-support/in-memory-invitation-repository.js";

const NOW = new Date("2026-07-30T00:00:00.000Z");
const EXPIRES_AT = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
const ids = new UuidGenerator();

function buildDeps() {
  const repository = new InMemoryInvitationRepository();
  const uow = new InMemoryUnitOfWork(new InMemoryEventBus());
  return { repository, uow };
}

function orgContext(organizationId: string): OrgScopedContext {
  return requireOrgScoped(
    createContext({ actor: { type: "user", id: ids.generate() }, organizationId }, ids),
  );
}

describe("listPendingInvitations", () => {
  it("returns pending invitations sorted by createdAt ascending, regardless of arrival order", async () => {
    const { repository, uow } = buildDeps();
    const organizationId = ids.generate();
    const context = orgContext(organizationId);

    const later = Invitation.create({
      id: ids.generate(),
      organizationId,
      email: "later@example.com",
      role: InvitationRole.Member,
      invitedBy: ids.generate(),
      now: new Date(NOW.getTime() + 2000),
      expiresAt: EXPIRES_AT,
    });
    const earlier = Invitation.create({
      id: ids.generate(),
      organizationId,
      email: "earlier@example.com",
      role: InvitationRole.Admin,
      invitedBy: ids.generate(),
      now: new Date(NOW.getTime() + 1000),
      expiresAt: EXPIRES_AT,
    });
    await repository.save({ publish: () => {} }, context, later);
    await repository.save({ publish: () => {} }, context, earlier);

    const result = await listPendingInvitations(context, { repository, uow });

    expect(result.map((i) => i.id)).toEqual([earlier.id.value, later.id.value]);
  });

  it("excludes ACCEPTED, REVOKED, and EXPIRED invitations (Section 6)", async () => {
    const { repository, uow } = buildDeps();
    const organizationId = ids.generate();
    const context = orgContext(organizationId);

    const accepted = Invitation.create({
      id: ids.generate(),
      organizationId,
      email: "accepted@example.com",
      role: InvitationRole.Member,
      invitedBy: ids.generate(),
      now: NOW,
      expiresAt: EXPIRES_AT,
    });
    accepted.accept(new Date(NOW.getTime() + 1000));

    const revoked = Invitation.create({
      id: ids.generate(),
      organizationId,
      email: "revoked@example.com",
      role: InvitationRole.Member,
      invitedBy: ids.generate(),
      now: NOW,
      expiresAt: EXPIRES_AT,
    });
    revoked.revoke(new Date(NOW.getTime() + 1000));

    const expired = Invitation.create({
      id: ids.generate(),
      organizationId,
      email: "expired@example.com",
      role: InvitationRole.Member,
      invitedBy: ids.generate(),
      now: NOW,
      expiresAt: EXPIRES_AT,
    });
    expired.expire(new Date(NOW.getTime() + 1000));

    const pending = Invitation.create({
      id: ids.generate(),
      organizationId,
      email: "pending@example.com",
      role: InvitationRole.Member,
      invitedBy: ids.generate(),
      now: NOW,
      expiresAt: EXPIRES_AT,
    });

    for (const invitation of [accepted, revoked, expired, pending]) {
      await repository.save({ publish: () => {} }, context, invitation);
    }

    const result = await listPendingInvitations(context, { repository, uow });
    expect(result.map((i) => i.id)).toEqual([pending.id.value]);
  });

  it("never returns another organization's invitations", async () => {
    const { repository, uow } = buildDeps();
    const orgA = ids.generate();
    const orgB = ids.generate();

    const invitationB = Invitation.create({
      id: ids.generate(),
      organizationId: orgB,
      email: "org-b@example.com",
      role: InvitationRole.Member,
      invitedBy: ids.generate(),
      now: NOW,
      expiresAt: EXPIRES_AT,
    });
    await repository.save({ publish: () => {} }, orgContext(orgB), invitationB);

    const result = await listPendingInvitations(orgContext(orgA), { repository, uow });
    expect(result).toEqual([]);
  });
});

describe("toPendingInvitationSummary", () => {
  it("maps every DTO field, with no status field", () => {
    const invitation = Invitation.create({
      id: ids.generate(),
      organizationId: ids.generate(),
      email: "invitee@example.com",
      role: InvitationRole.Admin,
      invitedBy: ids.generate(),
      now: NOW,
      expiresAt: EXPIRES_AT,
    });

    expect(toPendingInvitationSummary(invitation)).toEqual({
      id: invitation.id.value,
      email: "invitee@example.com",
      role: InvitationRole.Admin,
      invitedBy: invitation.invitedBy.value,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    });
  });
});
