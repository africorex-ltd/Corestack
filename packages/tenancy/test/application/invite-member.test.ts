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

import { Organization } from "../../src/domain/organization.js";
import type { Invitation } from "../../src/domain/invitation.js";
import type { Email } from "../../src/domain/email.js";
import { InvitationRole } from "../../src/domain/invitation-role.js";
import { InvitationStatus } from "../../src/domain/invitation-status.js";
import { CannotInviteOwnerError } from "../../src/application/cannot-invite-owner-error.js";
import { InvitationAlreadyExistsError } from "../../src/application/invitation-already-exists-error.js";
import { INVITATION_CREATED_EVENT } from "../../src/application/events.js";
import {
  inviteMember,
  type InviteMemberCommand,
} from "../../src/application/invite-member.js";
import type { OrganizationRepository } from "../../src/application/organization-repository.js";
import type { InvitationRepository } from "../../src/application/invitation-repository.js";

const NOW = new Date("2026-07-30T00:00:00.000Z");
const ORG_ID = "00000000-0000-7000-8000-000000000099";
const INVITED_BY = "00000000-0000-7000-8000-000000000098";

const VALID_COMMAND: InviteMemberCommand = {
  organizationId: ORG_ID,
  email: "invitee@example.com",
  role: InvitationRole.Member,
  invitedBy: INVITED_BY,
  requestId: "req-1",
};

/** Deterministic, valid-UUID-shaped ids — same test double `create-organization.test.ts` uses. */
class SequentialUuidGenerator implements IdGenerator {
  #next = 0;

  generate(): string {
    this.#next += 1;
    return `00000000-0000-7000-8000-${this.#next.toString().padStart(12, "0")}`;
  }
}

const FIRST_ID = "00000000-0000-7000-8000-000000000001";

function activeOrganization(): Organization {
  return Organization.create({
    id: ORG_ID,
    name: "Acme Corp",
    slug: "acme-corp",
    now: NOW,
  });
}

class FakeOrganizationRepository implements OrganizationRepository {
  organization: Organization | null = activeOrganization();
  findByIdCallCount = 0;

  async findById(): Promise<Organization | null> {
    this.findByIdCallCount += 1;
    return this.organization;
  }

  async listForContext(): Promise<readonly Organization[]> {
    return [];
  }

  async existsBySlug(): Promise<boolean> {
    return false;
  }

  async save(): Promise<void> {
    // not called by inviteMember
  }
}

/** In-memory repository test double — tracks call counts and holds saved invitations. */
class FakeInvitationRepository implements InvitationRepository {
  readonly pendingEmails = new Set<string>();
  readonly saved: Invitation[] = [];
  existsPendingForEmailCallCount = 0;
  saveCallCount = 0;

  async findById(): Promise<Invitation | null> {
    return null;
  }

  async listForOrganization(): Promise<readonly Invitation[]> {
    return [];
  }

  async existsPendingForEmail(_context: Context, email: Email): Promise<boolean> {
    this.existsPendingForEmailCallCount += 1;
    return this.pendingEmails.has(email.value);
  }

  async save(_context: Context, invitation: Invitation): Promise<void> {
    this.saveCallCount += 1;
    this.saved.push(invitation);
  }
}

function buildHarness() {
  const ids = new SequentialUuidGenerator();
  const clock = new FixedClock(NOW);
  const bus = new InMemoryEventBus();
  const published: DomainEvent[] = [];
  bus.subscribe({ consumer: "test-observer", event: "*", handler: (event) => void published.push(event) });
  const uow = new InMemoryUnitOfWork(bus);
  const organizationRepository = new FakeOrganizationRepository();
  const invitationRepository = new FakeInvitationRepository();
  // Explicit correlationId so ids.generate() isn't consumed by createContext
  // itself — keeps the aggregate's id deterministically the first one issued.
  const context: OrgScopedContext = requireOrgScoped(
    createContext(
      { actor: { type: "user", id: "user-1" }, correlationId: "corr-1", organizationId: ORG_ID },
      ids,
    ),
  );

  return { ids, clock, uow, organizationRepository, invitationRepository, context, published };
}

describe("inviteMember", () => {
  it("creates a pending invitation on success", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context } =
      buildHarness();

    const result = await inviteMember(context, VALID_COMMAND, {
      uow,
      organizationRepository,
      invitationRepository,
      ids,
      clock,
      invitationExpiryDays: 7,
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual({
      invitationId: FIRST_ID,
      organizationId: ORG_ID,
      email: "invitee@example.com",
      role: InvitationRole.Member,
      status: InvitationStatus.Pending,
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
      createdAt: NOW,
    });
  });

  it("normalizes email casing and surrounding whitespace", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context } =
      buildHarness();

    const result = await inviteMember(
      context,
      { ...VALID_COMMAND, email: "  Invitee@Example.COM  " },
      { uow, organizationRepository, invitationRepository, ids, clock, invitationExpiryDays: 7 },
    );

    expect(isOk(result)).toBe(true);
    expect(invitationRepository.saved[0]?.email.value).toBe("invitee@example.com");
  });

  it("rejects inviting an OWNER with CannotInviteOwnerError, before any aggregate is created", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context } =
      buildHarness();

    const result = await inviteMember(
      context,
      { ...VALID_COMMAND, role: "OWNER" },
      { uow, organizationRepository, invitationRepository, ids, clock, invitationExpiryDays: 7 },
    );

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error).toBeInstanceOf(CannotInviteOwnerError);
    expect(invitationRepository.saveCallCount).toBe(0);
  });

  it("returns InvitationAlreadyExistsError when a PENDING invitation already exists for the email, without creating or persisting anything", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context } =
      buildHarness();
    invitationRepository.pendingEmails.add("invitee@example.com");

    const result = await inviteMember(context, VALID_COMMAND, {
      uow,
      organizationRepository,
      invitationRepository,
      ids,
      clock,
      invitationExpiryDays: 7,
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error).toBeInstanceOf(InvitationAlreadyExistsError);
    expect(invitationRepository.saveCallCount).toBe(0);
  });

  it("rejects inviting into an inactive (SUSPENDED) organization", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context } =
      buildHarness();
    const suspended = activeOrganization();
    suspended.suspend(NOW);
    organizationRepository.organization = suspended;

    const result = await inviteMember(context, VALID_COMMAND, {
      uow,
      organizationRepository,
      invitationRepository,
      ids,
      clock,
      invitationExpiryDays: 7,
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error.message).toMatch(/not ACTIVE/);
    expect(invitationRepository.saveCallCount).toBe(0);
  });

  it("returns NotFoundError when the organization does not exist", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context } =
      buildHarness();
    organizationRepository.organization = null;

    const result = await inviteMember(context, VALID_COMMAND, {
      uow,
      organizationRepository,
      invitationRepository,
      ids,
      clock,
      invitationExpiryDays: 7,
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error.message).toMatch(/not found/);
    expect(invitationRepository.saveCallCount).toBe(0);
  });

  it("rejects a command organizationId that does not match the resolved context (ForbiddenError)", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context } =
      buildHarness();

    const result = await inviteMember(
      context,
      { ...VALID_COMMAND, organizationId: "00000000-0000-7000-8000-000000000001" },
      { uow, organizationRepository, invitationRepository, ids, clock, invitationExpiryDays: 7 },
    );

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error.message).toMatch(/does not match the resolved organization context/);
  });

  it("publishes an invitation.created event on success", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context, published } =
      buildHarness();

    await inviteMember(context, VALID_COMMAND, {
      uow,
      organizationRepository,
      invitationRepository,
      ids,
      clock,
      invitationExpiryDays: 7,
    });

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      name: INVITATION_CREATED_EVENT,
      version: 1,
      organizationId: ORG_ID,
      payload: {
        invitationId: FIRST_ID,
        organizationId: ORG_ID,
        email: "invitee@example.com",
        role: InvitationRole.Member,
        invitedBy: INVITED_BY,
      },
    });
  });

  it("publishes no events when the invitation is a duplicate", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context, published } =
      buildHarness();
    invitationRepository.pendingEmails.add("invitee@example.com");

    await inviteMember(context, VALID_COMMAND, {
      uow,
      organizationRepository,
      invitationRepository,
      ids,
      clock,
      invitationExpiryDays: 7,
    });

    expect(published).toHaveLength(0);
  });

  it("publishes no events when the role is OWNER", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context, published } =
      buildHarness();

    await inviteMember(
      context,
      { ...VALID_COMMAND, role: "OWNER" },
      { uow, organizationRepository, invitationRepository, ids, clock, invitationExpiryDays: 7 },
    );

    expect(published).toHaveLength(0);
  });

  it("computes expiresAt from the injected clock and configured invitationExpiryDays", async () => {
    const { uow, organizationRepository, invitationRepository, ids, context } = buildHarness();
    const fixedNow = new Date("2020-01-01T00:00:00.000Z");
    const clock = new FixedClock(fixedNow);

    const result = await inviteMember(context, VALID_COMMAND, {
      uow,
      organizationRepository,
      invitationRepository,
      ids,
      clock,
      invitationExpiryDays: 3,
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.createdAt.getTime()).toBe(fixedNow.getTime());
    expect(result.value.expiresAt.getTime()).toBe(fixedNow.getTime() + 3 * 24 * 60 * 60 * 1000);
  });

  it("calls findById, existsPendingForEmail, and save exactly once each on success", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context } =
      buildHarness();

    await inviteMember(context, VALID_COMMAND, {
      uow,
      organizationRepository,
      invitationRepository,
      ids,
      clock,
      invitationExpiryDays: 7,
    });

    expect(organizationRepository.findByIdCallCount).toBe(1);
    expect(invitationRepository.existsPendingForEmailCallCount).toBe(1);
    expect(invitationRepository.saveCallCount).toBe(1);
  });

  it("runs the whole flow through UnitOfWork.run", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context } =
      buildHarness();
    const runSpy = vi.spyOn(uow, "run");

    await inviteMember(context, VALID_COMMAND, {
      uow,
      organizationRepository,
      invitationRepository,
      ids,
      clock,
      invitationExpiryDays: 7,
    });

    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty requestId", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context } =
      buildHarness();

    const result = await inviteMember(
      context,
      { ...VALID_COMMAND, requestId: "" },
      { uow, organizationRepository, invitationRepository, ids, clock, invitationExpiryDays: 7 },
    );

    expect(isErr(result)).toBe(true);
  });

  it("rejects an invalid email", async () => {
    const { uow, organizationRepository, invitationRepository, ids, clock, context } =
      buildHarness();

    const result = await inviteMember(
      context,
      { ...VALID_COMMAND, email: "not-an-email" },
      { uow, organizationRepository, invitationRepository, ids, clock, invitationExpiryDays: 7 },
    );

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error.message).toMatch(/invalid email/);
  });
});
