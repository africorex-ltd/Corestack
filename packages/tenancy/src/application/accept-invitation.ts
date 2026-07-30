import {
  createEvent,
  err,
  ok,
  ForbiddenError,
  ValidationError,
  type Clock,
  type IdGenerator,
  type Result,
  type UnitOfWork,
} from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";

import { Membership } from "../domain/membership.js";
import { InvitationId } from "../domain/invitation-id.js";
import { UserId } from "../domain/user-id.js";
import { Email } from "../domain/email.js";
import { InvitationStatus } from "../domain/invitation-status.js";
import type { MembershipRole } from "../domain/membership-role.js";
import { InvitationNotFoundError } from "./invitation-not-found-error.js";
import { InvitationExpiredError } from "./invitation-expired-error.js";
import { InvitationNotPendingError } from "./invitation-not-pending-error.js";
import { MembershipAlreadyExistsError } from "./membership-already-exists-error.js";
import {
  INVITATION_ACCEPTED_EVENT,
  INVITATION_EXPIRED_EVENT,
  MEMBER_JOINED_EVENT,
  type InvitationAcceptedPayload,
  type InvitationExpiredPayload,
  type MemberJoinedPayload,
} from "./events.js";
import type { InvitationRepository } from "./invitation-repository.js";
import type { MembershipRepository } from "./membership-repository.js";

export interface AcceptInvitationCommand {
  readonly invitationId: string;
  /** The accepting user's id — becomes `Membership.userId` on success. */
  readonly userId: string;
  /**
   * The accepting user's claimed email identity, supplied by the
   * application layer (Section 3/13: identity is an application input,
   * never resolved here — this use case introduces no authentication).
   * Checked for equality against `invitation.email`; a mismatch is
   * treated as an authorization failure, not a validation failure — see
   * "Trust assumptions" in `docs/modules/accept-invitation-usecase.md`.
   */
  readonly email: string;
  /** Client-supplied idempotency/correlation token. Validated for presence only — same non-goal `createOrganization`/`inviteMember` document for their own `requestId`. */
  readonly requestId: string;
}

/** A DTO, not either aggregate (Section 6) — callers outside this module never see `Invitation`/`Membership` directly. */
export interface AcceptInvitationResult {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: MembershipRole;
  readonly joinedAt: Date;
}

export interface AcceptInvitationDeps {
  /** The generic kernel port, not `PostgresUnitOfWork` — no infrastructure coupling, matching `createOrganization`/`inviteMember`'s precedent. */
  readonly uow: UnitOfWork;
  readonly invitationRepository: InvitationRepository;
  readonly membershipRepository: MembershipRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/**
 * Runs `fn`, converting a thrown `ValidationError` into `Err`. Anything
 * else rethrows. Same helper `createOrganization`/`inviteMember` use —
 * only the domain layer's own expected-failure type is bridged into
 * `Result` space here.
 */
function tryDomain<T>(fn: () => T): Result<T, ValidationError> {
  try {
    return ok(fn());
  } catch (error) {
    if (error instanceof ValidationError) return err(error);
    throw error;
  }
}

/**
 * The `AcceptInvitation` use case (E05-T07) — the membership-admission
 * workflow. Coordinates the `Invitation` (E05-T05) and `Membership`
 * (E05-T04) aggregates through `InvitationRepository`/
 * `MembershipRepository` and `UnitOfWork` event publication. Contains no
 * domain rules of its own beyond the two pieces of orchestration logic
 * that don't belong in either aggregate: **time enforcement** (Section 7
 * — `Invitation.expire()` deliberately never compares `now` against
 * `expiresAt` itself, so this use case is the thing that does) and
 * **identity matching** (Section 3 — the accepting user's claimed email
 * against the invitation's own).
 *
 * Unlike `inviteMember` (E05-T06), this command carries no
 * `organizationId` field to check against `context.organizationId`:
 * `context: OrgScopedContext` already scopes every repository call, and
 * an org-scoped repository returning a row is itself the tenant-isolation
 * guarantee (the same structural property the RLS harness, E03-T30,
 * certifies) — there is no second, client-supplied `organizationId` here
 * for a mismatch to even be possible against, unlike `inviteMember`
 * where Section 3 explicitly required one on the command.
 *
 * The entire flow runs inside one `UnitOfWork.run()` call (Section 5:
 * "Persist both changes inside one UnitOfWork"), including the
 * expiry-enforcement branch, which persists the `EXPIRED` transition and
 * publishes its own event before returning `Err` — an expiry discovered
 * during acceptance is not a no-op rejection, it is itself a state
 * change that must be durable.
 */
export async function acceptInvitation(
  context: OrgScopedContext,
  command: AcceptInvitationCommand,
  deps: AcceptInvitationDeps,
): Promise<
  Result<
    AcceptInvitationResult,
    | ValidationError
    | ForbiddenError
    | InvitationNotFoundError
    | InvitationExpiredError
    | InvitationNotPendingError
    | MembershipAlreadyExistsError
  >
> {
  return deps.uow.run(async (tx) => {
    const invitationIdResult = tryDomain(() => InvitationId.from(command.invitationId.trim()));
    if (!invitationIdResult.ok) return invitationIdResult;
    const invitationId = invitationIdResult.value;

    const userIdResult = tryDomain(() => UserId.from(command.userId.trim()));
    if (!userIdResult.ok) return userIdResult;
    const userId = userIdResult.value;

    const emailResult = tryDomain(() => Email.from(command.email.trim()));
    if (!emailResult.ok) return emailResult;
    const email = emailResult.value;

    const requestId = command.requestId.trim();
    if (requestId.length === 0) {
      return err(
        new ValidationError("requestId must not be empty", { metadata: { field: "requestId" } }),
      );
    }

    // Section 5 step 1: the invitation must exist. findById (not a
    // pending-filtered lookup) is used deliberately — see
    // invitation-repository.ts's comment on why: this use case needs to
    // see the actual status to distinguish "not found" from "not
    // pending" from "pending but expired," three different errors.
    const invitation = await deps.invitationRepository.findById(context, invitationId.value);
    if (invitation === null) {
      return err(new InvitationNotFoundError(invitationId.value));
    }

    // Section 3: the accepting user must match the invitation's email
    // identity. This use case does not authenticate anyone — it trusts
    // that the application layer already verified `command.email`
    // genuinely belongs to `command.userId` (Section 13: "keep identity
    // as an application input"). A mismatch here means the *claim itself*
    // is inconsistent with the invitation being accepted, which is an
    // authorization failure (ForbiddenError), not malformed input. No
    // dedicated error type was added for this — Section 2's error list
    // has no acceptor-identity entry, and adding a sixth type beyond
    // Section 2's explicit five would exceed this task's scope.
    if (!invitation.email.equals(email)) {
      return err(
        new ForbiddenError(
          "accepting user's email does not match this invitation's recipient email",
          { metadata: { invitationId: invitationId.value } },
        ),
      );
    }

    if (invitation.status !== InvitationStatus.Pending) {
      return err(new InvitationNotPendingError(invitation.id.value, invitation.status));
    }

    // Section 7: this use case enforces time — Invitation.expire() itself
    // never compares now against expiresAt (E05-T05's own documented
    // gap). Discovering an expiry here is not a no-op rejection: the
    // EXPIRED transition is persisted and its event published before
    // returning Err, since the invitation's stored state must reflect
    // what actually happened.
    const now = deps.clock.now();
    if (now.getTime() >= invitation.expiresAt.getTime()) {
      const expiresAt = invitation.expiresAt;
      invitation.expire(now);
      await deps.invitationRepository.save(context, invitation);

      for (const event of invitation.pullDomainEvents()) {
        if (event.type !== "InvitationExpired") continue;
        tx.publish(
          createEvent<InvitationExpiredPayload>(
            {
              name: INVITATION_EXPIRED_EVENT,
              version: 1,
              organizationId: event.organizationId,
              payload: { invitationId: event.invitationId, organizationId: event.organizationId },
            },
            context,
            deps,
          ),
        );
      }
      invitation.clearDomainEvents();

      return err(new InvitationExpiredError(invitation.id.value, expiresAt));
    }

    // Section 5 step 3: no active membership may already exist for this
    // user in this organization.
    const alreadyActiveMember = await deps.membershipRepository.existsActive(
      context,
      userId.value,
    );
    if (alreadyActiveMember) {
      return err(new MembershipAlreadyExistsError(userId.value, context.organizationId));
    }

    // Section 5 steps 4-5: create the Membership and mark the invitation
    // accepted. invitation.role ("ADMIN" | "MEMBER") is assignable
    // directly to MembershipRole's wider union — no cast needed.
    const membership = Membership.create({
      id: deps.ids.generate(),
      organizationId: invitation.organizationId.value,
      userId: userId.value,
      role: invitation.role,
      now,
    });
    invitation.accept(now);

    // Section 5 step 6: both changes persisted inside this one UnitOfWork.
    await deps.membershipRepository.save(context, membership);
    await deps.invitationRepository.save(context, invitation);

    // Section 5 step 7: publish all resulting domain events.
    for (const event of membership.pullDomainEvents()) {
      // Membership.create() only ever emits MembershipCreated. The other
      // MembershipDomainEvent types belong to whichever future use case
      // calls those aggregate methods, not this one.
      if (event.type !== "MembershipCreated") continue;
      tx.publish(
        createEvent<MemberJoinedPayload>(
          {
            name: MEMBER_JOINED_EVENT,
            version: 1,
            organizationId: event.organizationId,
            payload: {
              organizationId: event.organizationId,
              membershipId: event.membershipId,
              userId: event.userId,
              role: event.role,
            },
          },
          context,
          deps,
        ),
      );
    }
    membership.clearDomainEvents();

    for (const event of invitation.pullDomainEvents()) {
      if (event.type !== "InvitationAccepted") continue;
      tx.publish(
        createEvent<InvitationAcceptedPayload>(
          {
            name: INVITATION_ACCEPTED_EVENT,
            version: 1,
            organizationId: event.organizationId,
            payload: { invitationId: event.invitationId, organizationId: event.organizationId },
          },
          context,
          deps,
        ),
      );
    }
    invitation.clearDomainEvents();

    return ok({
      membershipId: membership.id.value,
      organizationId: membership.organizationId.value,
      userId: membership.userId.value,
      role: membership.role,
      joinedAt: membership.joinedAt,
    });
  });
}
