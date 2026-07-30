import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";
import type { TransactionContext } from "@corestack/kernel";

import { Membership } from "../../src/domain/membership.js";
import { MembershipRole } from "../../src/domain/membership-role.js";
import { MembershipStatus } from "../../src/domain/membership-status.js";
import { InvitationRole } from "../../src/domain/invitation-role.js";
import { InvitationStatus } from "../../src/domain/invitation-status.js";
import { InvitationExpiredError } from "../../src/application/invitation-expired-error.js";
import { InvitationNotPendingError } from "../../src/application/invitation-not-pending-error.js";
import { InviterNotAuthorizedError } from "../../src/application/inviter-not-authorized-error.js";
import { InvitationAlreadyExistsError } from "../../src/application/invitation-already-exists-error.js";
import { MembershipAlreadyExistsError } from "../../src/application/membership-already-exists-error.js";
import { DuplicateSlugError } from "../../src/application/duplicate-slug-error.js";
import { acceptInvitation } from "../../src/application/accept-invitation.js";
import type { InvitationRepository } from "../../src/application/invitation-repository.js";
import type { Invitation } from "../../src/domain/invitation.js";

import { TenancyWorkflowHarness } from "../../test-support/workflow-harness.js";

const OWNER_ID = "00000000-0000-7000-8000-000000000001";
const ADMIN_ID = "00000000-0000-7000-8000-000000000002";
const MEMBER_ID = "00000000-0000-7000-8000-000000000003";

/** A no-op `TransactionContext` for direct repository calls made outside any use case's `uow.run()` — pure test setup, not a workflow step under test, so there is no real transaction to thread through. */
const NO_OP_TX: TransactionContext = { publish: () => {} };

/** Seeds an ACTIVE membership directly via the repository — bypassing any use case, since no `createOrganization`-adjacent command auto-creates an owner membership yet (a documented non-goal). Publishes no event: this is test setup, not a workflow step under test. */
async function seedMembership(
  harness: TenancyWorkflowHarness,
  orgContext: OrgScopedContext,
  userId: string,
  role: MembershipRole,
): Promise<void> {
  const membership = Membership.create({
    id: harness.ids.generate(),
    organizationId: orgContext.organizationId,
    userId,
    role,
    now: harness.clock.now(),
  });
  await harness.membershipRepository.save(NO_OP_TX, orgContext, membership);
}

/** Creates an organization and returns its id plus an `OrgScopedContext` for it — the common setup step every scenario below starts from. */
async function createOrg(harness: TenancyWorkflowHarness, slug: string) {
  const result = await harness.createOrganization({
    name: "Acme Corp",
    slug,
    requestedBy: OWNER_ID,
    requestId: "req-create",
  });
  if (!result.ok) throw new Error(`setup failed: ${result.error.message}`);
  const organizationId = result.value.organizationId;
  return { organizationId, orgContext: harness.orgContext(organizationId) };
}

describe("Tenancy workflow integration (E05-T08)", () => {
  describe("end-to-end: create organization -> invite -> accept", () => {
    it("runs the full workflow and emits events in order", async () => {
      const harness = new TenancyWorkflowHarness();
      const { organizationId, orgContext } = await createOrg(harness, "acme-corp");
      await seedMembership(harness, orgContext, OWNER_ID, MembershipRole.Owner);

      const invite = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Member,
        invitedBy: OWNER_ID,
        requestId: "req-invite",
      });
      expect(isOk(invite)).toBe(true);
      if (!invite.ok) throw new Error("expected ok");

      const accept = await harness.acceptInvitation(orgContext, {
        invitationId: invite.value.invitationId,
        userId: MEMBER_ID,
        email: "invitee@example.com",
        requestId: "req-accept",
      });
      expect(isOk(accept)).toBe(true);
      if (!accept.ok) throw new Error("expected ok");
      expect(accept.value.role).toBe(MembershipRole.Member);

      harness.events.expectSequence([
        "organization.created",
        "invitation.created",
        "member.joined",
        "invitation.accepted",
      ]);
      expect(harness.events.payloadAt(2)).toMatchObject({
        organizationId,
        userId: MEMBER_ID,
        role: MembershipRole.Member,
      });
    });
  });

  describe("duplicate slug", () => {
    it("rejects a second organization with the same slug, without a second event", async () => {
      const harness = new TenancyWorkflowHarness();
      await createOrg(harness, "acme-corp");
      harness.events.clear();

      const second = await harness.createOrganization({
        name: "Acme Corp Again",
        slug: "acme-corp",
        requestedBy: OWNER_ID,
        requestId: "req-create-2",
      });

      expect(isErr(second)).toBe(true);
      if (second.ok) throw new Error("expected err");
      expect(second.error).toBeInstanceOf(DuplicateSlugError);
      harness.events.expectNone();
    });
  });

  describe("duplicate invitation", () => {
    it("rejects a second pending invitation for the same email, without a second event", async () => {
      const harness = new TenancyWorkflowHarness();
      const { organizationId, orgContext } = await createOrg(harness, "acme-corp");
      await seedMembership(harness, orgContext, OWNER_ID, MembershipRole.Owner);
      await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Member,
        invitedBy: OWNER_ID,
        requestId: "req-invite-1",
      });
      harness.events.clear();

      const second = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Member,
        invitedBy: OWNER_ID,
        requestId: "req-invite-2",
      });

      expect(isErr(second)).toBe(true);
      if (second.ok) throw new Error("expected err");
      expect(second.error).toBeInstanceOf(InvitationAlreadyExistsError);
      harness.events.expectNone();
      const invitations = await harness.invitationRepository.listForOrganization(NO_OP_TX, orgContext);
      expect(invitations).toHaveLength(1);
    });
  });

  describe("expired invitation", () => {
    it("marks the invitation EXPIRED, publishes invitation.expired, and creates no membership", async () => {
      const harness = new TenancyWorkflowHarness();
      const { organizationId, orgContext } = await createOrg(harness, "acme-corp");
      await seedMembership(harness, orgContext, OWNER_ID, MembershipRole.Owner);
      const invite = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Member,
        invitedBy: OWNER_ID,
        requestId: "req-invite",
      });
      if (!invite.ok) throw new Error("expected ok");
      harness.events.clear();

      harness.clock.advance(harness.config.invitationExpiryDays * 24 * 60 * 60 * 1000 + 1);

      const accept = await harness.acceptInvitation(orgContext, {
        invitationId: invite.value.invitationId,
        userId: MEMBER_ID,
        email: "invitee@example.com",
        requestId: "req-accept",
      });

      expect(isErr(accept)).toBe(true);
      if (accept.ok) throw new Error("expected err");
      expect(accept.error).toBeInstanceOf(InvitationExpiredError);
      harness.events.expectSequence(["invitation.expired"]);

      const invitation = await harness.invitationRepository.findById(
        NO_OP_TX,
        orgContext,
        invite.value.invitationId,
      );
      expect(invitation?.status).toBe(InvitationStatus.Expired);

      const membership = await harness.membershipRepository.findByUserId(NO_OP_TX, orgContext, MEMBER_ID);
      expect(membership).toBeNull();
    });
  });

  describe("revoked invitation", () => {
    it("rejects acceptance with InvitationNotPendingError, without mutating membership state", async () => {
      const harness = new TenancyWorkflowHarness();
      const { organizationId, orgContext } = await createOrg(harness, "acme-corp");
      await seedMembership(harness, orgContext, OWNER_ID, MembershipRole.Owner);
      const invite = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Member,
        invitedBy: OWNER_ID,
        requestId: "req-invite",
      });
      if (!invite.ok) throw new Error("expected ok");

      const invitation = await harness.invitationRepository.findById(
        NO_OP_TX,
        orgContext,
        invite.value.invitationId,
      );
      if (invitation === null) throw new Error("setup failed: invitation not found");
      invitation.revoke(harness.clock.now());
      await harness.invitationRepository.save(NO_OP_TX, orgContext, invitation);
      harness.events.clear();

      const accept = await harness.acceptInvitation(orgContext, {
        invitationId: invite.value.invitationId,
        userId: MEMBER_ID,
        email: "invitee@example.com",
        requestId: "req-accept",
      });

      expect(isErr(accept)).toBe(true);
      if (accept.ok) throw new Error("expected err");
      expect(accept.error).toBeInstanceOf(InvitationNotPendingError);
      harness.events.expectNone();
      const membership = await harness.membershipRepository.findByUserId(NO_OP_TX, orgContext, MEMBER_ID);
      expect(membership).toBeNull();
    });
  });

  describe("inviter authorization (Section 6/8)", () => {
    it("rejects an unauthorized inviter (no membership at all)", async () => {
      const harness = new TenancyWorkflowHarness();
      const { organizationId, orgContext } = await createOrg(harness, "acme-corp");
      harness.events.clear();

      const invite = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Member,
        invitedBy: OWNER_ID,
        requestId: "req-invite",
      });

      expect(isErr(invite)).toBe(true);
      if (invite.ok) throw new Error("expected err");
      expect(invite.error).toBeInstanceOf(InviterNotAuthorizedError);
      harness.events.expectNone();
      const invitations = await harness.invitationRepository.listForOrganization(NO_OP_TX, orgContext);
      expect(invitations).toHaveLength(0);
    });

    it("ADMIN can invite MEMBER", async () => {
      const harness = new TenancyWorkflowHarness();
      const { organizationId, orgContext } = await createOrg(harness, "acme-corp");
      await seedMembership(harness, orgContext, ADMIN_ID, MembershipRole.Admin);

      const invite = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Member,
        invitedBy: ADMIN_ID,
        requestId: "req-invite",
      });

      expect(isOk(invite)).toBe(true);
    });

    it("ADMIN cannot invite ADMIN", async () => {
      const harness = new TenancyWorkflowHarness();
      const { organizationId, orgContext } = await createOrg(harness, "acme-corp");
      await seedMembership(harness, orgContext, ADMIN_ID, MembershipRole.Admin);

      const invite = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Admin,
        invitedBy: ADMIN_ID,
        requestId: "req-invite",
      });

      expect(isErr(invite)).toBe(true);
      if (invite.ok) throw new Error("expected err");
      expect(invite.error).toBeInstanceOf(InviterNotAuthorizedError);
    });

    it("OWNER can invite ADMIN", async () => {
      const harness = new TenancyWorkflowHarness();
      const { organizationId, orgContext } = await createOrg(harness, "acme-corp");
      await seedMembership(harness, orgContext, OWNER_ID, MembershipRole.Owner);

      const invite = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Admin,
        invitedBy: OWNER_ID,
        requestId: "req-invite",
      });

      expect(isOk(invite)).toBe(true);
    });
  });

  describe("consumed/created exactly once", () => {
    it("a second acceptance of the same invitation fails and creates no second membership", async () => {
      const harness = new TenancyWorkflowHarness();
      const { organizationId, orgContext } = await createOrg(harness, "acme-corp");
      await seedMembership(harness, orgContext, OWNER_ID, MembershipRole.Owner);
      const invite = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Member,
        invitedBy: OWNER_ID,
        requestId: "req-invite",
      });
      if (!invite.ok) throw new Error("expected ok");

      const first = await harness.acceptInvitation(orgContext, {
        invitationId: invite.value.invitationId,
        userId: MEMBER_ID,
        email: "invitee@example.com",
        requestId: "req-accept-1",
      });
      expect(isOk(first)).toBe(true);
      harness.events.clear();

      const second = await harness.acceptInvitation(orgContext, {
        invitationId: invite.value.invitationId,
        userId: MEMBER_ID,
        email: "invitee@example.com",
        requestId: "req-accept-2",
      });

      expect(isErr(second)).toBe(true);
      if (second.ok) throw new Error("expected err");
      expect(second.error).toBeInstanceOf(InvitationNotPendingError);
      harness.events.expectNone();

      const memberships = await harness.membershipRepository.listForOrganization(NO_OP_TX, orgContext);
      const forMember = memberships.filter((m) => m.userId.value === MEMBER_ID);
      expect(forMember).toHaveLength(1);
      expect(forMember[0]?.status).toBe(MembershipStatus.Active);
    });
  });

  describe("transaction semantics (Section 7)", () => {
    it("an unauthorized inviteMember leaves no partial invitation state", async () => {
      const harness = new TenancyWorkflowHarness();
      const { organizationId, orgContext } = await createOrg(harness, "acme-corp");
      await seedMembership(harness, orgContext, MEMBER_ID, MembershipRole.Member);
      harness.events.clear();

      const invite = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Member,
        invitedBy: MEMBER_ID,
        requestId: "req-invite",
      });

      expect(isErr(invite)).toBe(true);
      harness.events.expectNone();
      const invitations = await harness.invitationRepository.listForOrganization(NO_OP_TX, orgContext);
      expect(invitations).toHaveLength(0);
    });

    it("a MembershipAlreadyExistsError failure leaves the second invitation PENDING and untouched", async () => {
      const harness = new TenancyWorkflowHarness();
      const { organizationId, orgContext } = await createOrg(harness, "acme-corp");
      await seedMembership(harness, orgContext, OWNER_ID, MembershipRole.Owner);
      const firstInvite = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Member,
        invitedBy: OWNER_ID,
        requestId: "req-invite-1",
      });
      if (!firstInvite.ok) throw new Error("expected ok");
      const firstAccept = await harness.acceptInvitation(orgContext, {
        invitationId: firstInvite.value.invitationId,
        userId: MEMBER_ID,
        email: "invitee@example.com",
        requestId: "req-accept-1",
      });
      expect(isOk(firstAccept)).toBe(true);

      // A second, independent invitation for the same now-already-a-member user
      // (a different email, since existsPendingForEmail would otherwise block
      // this at inviteMember's own duplicate check before acceptInvitation is
      // ever reached).
      const secondInvite = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee-again@example.com",
        role: InvitationRole.Member,
        invitedBy: OWNER_ID,
        requestId: "req-invite-2",
      });
      if (!secondInvite.ok) throw new Error("expected ok");
      harness.events.clear();

      const secondAccept = await harness.acceptInvitation(orgContext, {
        invitationId: secondInvite.value.invitationId,
        userId: MEMBER_ID,
        email: "invitee-again@example.com",
        requestId: "req-accept-2",
      });

      expect(isErr(secondAccept)).toBe(true);
      if (secondAccept.ok) throw new Error("expected err");
      expect(secondAccept.error).toBeInstanceOf(MembershipAlreadyExistsError);
      harness.events.expectNone();

      const secondInvitation = await harness.invitationRepository.findById(
        NO_OP_TX,
        orgContext,
        secondInvite.value.invitationId,
      );
      expect(secondInvitation?.status).toBe(InvitationStatus.Pending);

      const memberships = await harness.membershipRepository.listForOrganization(NO_OP_TX, orgContext);
      expect(memberships.filter((m) => m.userId.value === MEMBER_ID)).toHaveLength(1);
    });

    /**
     * The in-memory `UnitOfWork` provides **event-staging atomicity only**,
     * not storage rollback (Section 8's "failure semantics" — see
     * docs/modules/tenancy-workflow-integration.md). `acceptInvitation`
     * calls `membershipRepository.save` before `invitationRepository.save`;
     * if the *second* save throws, the first has already landed. This test
     * proves that property directly rather than merely asserting it in
     * prose: a real `PostgresUnitOfWork` (E03-T40) wrapping both writes in
     * one SQL transaction is what actually closes this gap — not part of
     * this task's scope (Section 1: "before persistence is introduced").
     */
    it("a mid-flow repository failure leaves partial state (no rollback in the in-memory UnitOfWork)", async () => {
      const harness = new TenancyWorkflowHarness();
      const { organizationId, orgContext } = await createOrg(harness, "acme-corp");
      await seedMembership(harness, orgContext, OWNER_ID, MembershipRole.Owner);
      const invite = await harness.inviteMember(orgContext, {
        organizationId,
        email: "invitee@example.com",
        role: InvitationRole.Member,
        invitedBy: OWNER_ID,
        requestId: "req-invite",
      });
      if (!invite.ok) throw new Error("expected ok");
      harness.events.clear();

      class ThrowingInvitationRepository implements InvitationRepository {
        constructor(private readonly inner: InvitationRepository) {}
        findById(
          tx: TransactionContext,
          context: OrgScopedContext,
          invitationId: string,
        ): Promise<Invitation | null> {
          return this.inner.findById(tx, context, invitationId);
        }
        listForOrganization(
          tx: TransactionContext,
          context: OrgScopedContext,
        ): Promise<readonly Invitation[]> {
          return this.inner.listForOrganization(tx, context);
        }
        existsPendingForEmail(...args: Parameters<InvitationRepository["existsPendingForEmail"]>) {
          return this.inner.existsPendingForEmail(...args);
        }
        async save(): Promise<void> {
          throw new Error("simulated persistence failure");
        }
      }

      const throwingInvitationRepository = new ThrowingInvitationRepository(
        harness.invitationRepository,
      );

      await expect(
        acceptInvitation(
          orgContext,
          {
            invitationId: invite.value.invitationId,
            userId: MEMBER_ID,
            email: "invitee@example.com",
            requestId: "req-accept",
          },
          {
            uow: harness.uow,
            invitationRepository: throwingInvitationRepository,
            membershipRepository: harness.membershipRepository,
            ids: harness.ids,
            clock: harness.clock,
          },
        ),
      ).rejects.toThrow(/simulated persistence failure/);

      // The membership save (first) already landed, despite the overall
      // throw — proving there is no automatic rollback in the in-memory path.
      const membership = await harness.membershipRepository.findByUserId(NO_OP_TX, orgContext, MEMBER_ID);
      expect(membership).not.toBeNull();
      expect(membership?.status).toBe(MembershipStatus.Active);

      // No events were published: InMemoryUnitOfWork.run only calls
      // bus.publish(staged) after work(tx) returns, and here work(tx) threw
      // before returning — so event-staging atomicity held even though
      // storage did not.
      harness.events.expectNone();
    });
  });
});
