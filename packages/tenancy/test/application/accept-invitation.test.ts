import { describe, expect, it, vi } from "vitest";
import {
  FixedClock,
  InMemoryEventBus,
  InMemoryUnitOfWork,
  createContext,
  isErr,
  isOk,
  type Context,
  type DomainEvent,
  type IdGenerator,
} from "@corestack/kernel";
import { requireOrgScoped, type OrgScopedContext } from "@corestack/platform";

import { Invitation } from "../../src/domain/invitation.js";
import { InvitationRole } from "../../src/domain/invitation-role.js";
import { InvitationStatus } from "../../src/domain/invitation-status.js";
import type { Membership } from "../../src/domain/membership.js";
import { MembershipRole } from "../../src/domain/membership-role.js";
import { InvitationNotFoundError } from "../../src/application/invitation-not-found-error.js";
import { InvitationExpiredError } from "../../src/application/invitation-expired-error.js";
import { InvitationNotPendingError } from "../../src/application/invitation-not-pending-error.js";
import { MembershipAlreadyExistsError } from "../../src/application/membership-already-exists-error.js";
import { INVITATION_ACCEPTED_EVENT, INVITATION_EXPIRED_EVENT, MEMBER_JOINED_EVENT } from "../../src/application/events.js";
import {
  acceptInvitation,
  type AcceptInvitationCommand,
} from "../../src/application/accept-invitation.js";
import type { InvitationRepository } from "../../src/application/invitation-repository.js";
import type { MembershipRepository } from "../../src/application/membership-repository.js";

const NOW = new Date("2026-07-30T00:00:00.000Z");
const ORG_ID = "00000000-0000-7000-8000-000000000099";
const USER_ID = "00000000-0000-7000-8000-000000000098";
const INVITATION_ID = "00000000-0000-7000-8000-000000000097";
const INVITEE_EMAIL = "invitee@example.com";

/** Deterministic, valid-UUID-shaped ids — same test double `invite-member.test.ts` uses. */
class SequentialUuidGenerator implements IdGenerator {
  #next = 0;

  generate(): string {
    this.#next += 1;
    return `00000000-0000-7000-8000-${this.#next.toString().padStart(12, "0")}`;
  }
}

const FIRST_ID = "00000000-0000-7000-8000-000000000001";

function pendingInvitation(overrides: { role?: InvitationRole; expiresAt?: Date } = {}): Invitation {
  return Invitation.create({
    id: INVITATION_ID,
    organizationId: ORG_ID,
    email: INVITEE_EMAIL,
    role: overrides.role ?? InvitationRole.Member,
    invitedBy: "00000000-0000-7000-8000-000000000096",
    now: NOW,
    expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
  });
}

const VALID_COMMAND: AcceptInvitationCommand = {
  invitationId: INVITATION_ID,
  userId: USER_ID,
  email: INVITEE_EMAIL,
  requestId: "req-1",
};

/** In-memory repository test double — holds a settable invitation and tracks call counts. */
class FakeInvitationRepository implements InvitationRepository {
  invitation: Invitation | null = pendingInvitation();
  readonly saved: Invitation[] = [];
  findByIdCallCount = 0;
  saveCallCount = 0;

  async findById(): Promise<Invitation | null> {
    this.findByIdCallCount += 1;
    return this.invitation;
  }

  async listForOrganization(): Promise<readonly Invitation[]> {
    return [];
  }

  async existsPendingForEmail(): Promise<boolean> {
    return false;
  }

  async save(_context: Context, invitation: Invitation): Promise<void> {
    this.saveCallCount += 1;
    this.saved.push(invitation);
  }
}

/** In-memory repository test double — tracks call counts and holds saved memberships. */
class FakeMembershipRepository implements MembershipRepository {
  activeExists = false;
  readonly saved: Membership[] = [];
  existsActiveCallCount = 0;
  saveCallCount = 0;

  async findById(): Promise<Membership | null> {
    return null;
  }

  async listForOrganization(): Promise<readonly Membership[]> {
    return [];
  }

  async findByUserId(): Promise<Membership | null> {
    return null;
  }

  async existsActive(): Promise<boolean> {
    this.existsActiveCallCount += 1;
    return this.activeExists;
  }

  async save(_context: Context, membership: Membership): Promise<void> {
    this.saveCallCount += 1;
    this.saved.push(membership);
  }
}

function buildHarness() {
  const ids = new SequentialUuidGenerator();
  const clock = new FixedClock(NOW);
  const bus = new InMemoryEventBus();
  const published: DomainEvent[] = [];
  bus.subscribe({ consumer: "test-observer", event: "*", handler: (event) => void published.push(event) });
  const uow = new InMemoryUnitOfWork(bus);
  const invitationRepository = new FakeInvitationRepository();
  const membershipRepository = new FakeMembershipRepository();
  const context: OrgScopedContext = requireOrgScoped(
    createContext(
      { actor: { type: "user", id: "user-1" }, correlationId: "corr-1", organizationId: ORG_ID },
      ids,
    ),
  );

  return { ids, clock, uow, invitationRepository, membershipRepository, context, published };
}

describe("acceptInvitation", () => {
  it("creates an ACTIVE membership at the invitation's role on success", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context } = buildHarness();

    const result = await acceptInvitation(context, VALID_COMMAND, {
      uow,
      invitationRepository,
      membershipRepository,
      ids,
      clock,
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual({
      membershipId: FIRST_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      role: MembershipRole.Member,
      joinedAt: NOW,
    });
  });

  it("creates an ADMIN membership when the invitation's role is ADMIN", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context } = buildHarness();
    invitationRepository.invitation = pendingInvitation({ role: InvitationRole.Admin });

    const result = await acceptInvitation(context, VALID_COMMAND, {
      uow,
      invitationRepository,
      membershipRepository,
      ids,
      clock,
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.role).toBe(MembershipRole.Admin);
  });

  it("returns InvitationNotFoundError when the invitation does not exist", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context } = buildHarness();
    invitationRepository.invitation = null;

    const result = await acceptInvitation(context, VALID_COMMAND, {
      uow,
      invitationRepository,
      membershipRepository,
      ids,
      clock,
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error).toBeInstanceOf(InvitationNotFoundError);
    expect(membershipRepository.saveCallCount).toBe(0);
  });

  it("rejects a mismatched accepting-user email (ForbiddenError)", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context } = buildHarness();

    const result = await acceptInvitation(
      context,
      { ...VALID_COMMAND, email: "someone-else@example.com" },
      { uow, invitationRepository, membershipRepository, ids, clock },
    );

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error.message).toMatch(/does not match/);
    expect(membershipRepository.saveCallCount).toBe(0);
  });

  it("returns InvitationNotPendingError for an already-ACCEPTED invitation", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context } = buildHarness();
    const invitation = pendingInvitation();
    invitation.accept(NOW);
    invitationRepository.invitation = invitation;

    const result = await acceptInvitation(context, VALID_COMMAND, {
      uow,
      invitationRepository,
      membershipRepository,
      ids,
      clock,
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error).toBeInstanceOf(InvitationNotPendingError);
    expect(membershipRepository.saveCallCount).toBe(0);
  });

  it("returns InvitationNotPendingError for a REVOKED invitation", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context } = buildHarness();
    const invitation = pendingInvitation();
    invitation.revoke(NOW);
    invitationRepository.invitation = invitation;

    const result = await acceptInvitation(context, VALID_COMMAND, {
      uow,
      invitationRepository,
      membershipRepository,
      ids,
      clock,
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error).toBeInstanceOf(InvitationNotPendingError);
    expect(membershipRepository.saveCallCount).toBe(0);
  });

  it("returns InvitationExpiredError and persists the EXPIRED transition when now >= expiresAt", async () => {
    const { uow, invitationRepository, membershipRepository, ids, context } = buildHarness();
    const expiresAt = new Date(NOW.getTime() + 1000);
    invitationRepository.invitation = pendingInvitation({ expiresAt });
    const clock = new FixedClock(expiresAt);

    const result = await acceptInvitation(context, VALID_COMMAND, {
      uow,
      invitationRepository,
      membershipRepository,
      ids,
      clock,
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error).toBeInstanceOf(InvitationExpiredError);
    expect(invitationRepository.saveCallCount).toBe(1);
    expect(invitationRepository.saved[0]?.status).toBe(InvitationStatus.Expired);
    expect(membershipRepository.saveCallCount).toBe(0);
  });

  it("publishes invitation.expired (not invitation.accepted) on the expiry path", async () => {
    const { uow, invitationRepository, membershipRepository, ids, context, published } =
      buildHarness();
    const expiresAt = new Date(NOW.getTime() + 1000);
    invitationRepository.invitation = pendingInvitation({ expiresAt });
    const clock = new FixedClock(expiresAt);

    await acceptInvitation(context, VALID_COMMAND, {
      uow,
      invitationRepository,
      membershipRepository,
      ids,
      clock,
    });

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      name: INVITATION_EXPIRED_EVENT,
      organizationId: ORG_ID,
      payload: { invitationId: INVITATION_ID, organizationId: ORG_ID },
    });
  });

  it("returns MembershipAlreadyExistsError when the user already has an active membership", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context } = buildHarness();
    membershipRepository.activeExists = true;

    const result = await acceptInvitation(context, VALID_COMMAND, {
      uow,
      invitationRepository,
      membershipRepository,
      ids,
      clock,
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error).toBeInstanceOf(MembershipAlreadyExistsError);
    expect(membershipRepository.saveCallCount).toBe(0);
    // Neither accept() nor a persisted change should have happened to the invitation.
    expect(invitationRepository.saveCallCount).toBe(0);
  });

  it("publishes member.joined and invitation.accepted on success", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context, published } =
      buildHarness();

    await acceptInvitation(context, VALID_COMMAND, {
      uow,
      invitationRepository,
      membershipRepository,
      ids,
      clock,
    });

    expect(published).toHaveLength(2);
    expect(published).toContainEqual(
      expect.objectContaining({
        name: MEMBER_JOINED_EVENT,
        organizationId: ORG_ID,
        payload: expect.objectContaining({
          organizationId: ORG_ID,
          userId: USER_ID,
          role: MembershipRole.Member,
        }),
      }),
    );
    expect(published).toContainEqual(
      expect.objectContaining({
        name: INVITATION_ACCEPTED_EVENT,
        organizationId: ORG_ID,
        payload: { invitationId: INVITATION_ID, organizationId: ORG_ID },
      }),
    );
  });

  it("persists the invitation as ACCEPTED on success", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context } = buildHarness();

    await acceptInvitation(context, VALID_COMMAND, {
      uow,
      invitationRepository,
      membershipRepository,
      ids,
      clock,
    });

    expect(invitationRepository.saveCallCount).toBe(1);
    expect(invitationRepository.saved[0]?.status).toBe(InvitationStatus.Accepted);
  });

  it("persists the new membership on success", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context } = buildHarness();

    await acceptInvitation(context, VALID_COMMAND, {
      uow,
      invitationRepository,
      membershipRepository,
      ids,
      clock,
    });

    expect(membershipRepository.saveCallCount).toBe(1);
    expect(membershipRepository.saved[0]?.userId.value).toBe(USER_ID);
  });

  it("runs the whole flow through UnitOfWork.run", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context } = buildHarness();
    const runSpy = vi.spyOn(uow, "run");

    await acceptInvitation(context, VALID_COMMAND, {
      uow,
      invitationRepository,
      membershipRepository,
      ids,
      clock,
    });

    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty requestId", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context } = buildHarness();

    const result = await acceptInvitation(
      context,
      { ...VALID_COMMAND, requestId: "" },
      { uow, invitationRepository, membershipRepository, ids, clock },
    );

    expect(isErr(result)).toBe(true);
  });

  it("rejects an invalid invitationId", async () => {
    const { uow, invitationRepository, membershipRepository, ids, clock, context } = buildHarness();

    const result = await acceptInvitation(
      context,
      { ...VALID_COMMAND, invitationId: "not-a-uuid" },
      { uow, invitationRepository, membershipRepository, ids, clock },
    );

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error.message).toMatch(/invalid invitation id/);
  });
});
