import {
  createEvent,
  err,
  ok,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Clock,
  type IdGenerator,
  type Result,
  type UnitOfWork,
} from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";

import { Invitation } from "../domain/invitation.js";
import { Email } from "../domain/email.js";
import { OrganizationId } from "../domain/organization-id.js";
import { UserId } from "../domain/user-id.js";
import { assertValidInvitationRole, type InvitationRole } from "../domain/invitation-role.js";
import type { InvitationStatus } from "../domain/invitation-status.js";
import { OrganizationStatus } from "../domain/organization-status.js";
import { MembershipStatus } from "../domain/membership-status.js";
import { CannotInviteOwnerError } from "./cannot-invite-owner-error.js";
import { InvitationAlreadyExistsError } from "./invitation-already-exists-error.js";
import { InviterNotAuthorizedError } from "./inviter-not-authorized-error.js";
import { canInviteAs } from "./invite-authorization.js";
import { INVITATION_CREATED_EVENT, type InvitationCreatedPayload } from "./events.js";
import type { OrganizationRepository } from "./organization-repository.js";
import type { InvitationRepository } from "./invitation-repository.js";
import type { MembershipRepository } from "./membership-repository.js";

export interface InviteMemberCommand {
  readonly organizationId: string;
  readonly email: string;
  /** Raw string, checked for `"OWNER"` by this use case and, as defense-in-depth, by `Invitation.create`'s own `assertValidInvitationRole`. */
  readonly role: string;
  readonly invitedBy: string;
  /** Client-supplied idempotency/correlation token. Validated for presence only — not yet wired to an `IdempotencyStore`, same non-goal `createOrganization` (E05-T03) documented for its own `requestId`. */
  readonly requestId: string;
}

/** A DTO, not the aggregate (Section 6) — callers outside this module never see `Invitation` directly. */
export interface InviteMemberResult {
  readonly invitationId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: InvitationRole;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface InviteMemberDeps {
  /** The generic kernel port, not `PostgresUnitOfWork` — no infrastructure coupling, matching `createOrganization`'s precedent. */
  readonly uow: UnitOfWork;
  readonly organizationRepository: OrganizationRepository;
  readonly invitationRepository: InvitationRepository;
  /**
   * Added in E05-T07 for the inviter-authorization check (Section 8) —
   * looks up the inviter's own membership via `findByUserId`. Not present
   * in E05-T06: this use case had no membership dependency at all until
   * this task closed the "does the inviter have permission to invite"
   * gap flagged in `docs/modules/invite-member-usecase.md`'s non-goals.
   */
  readonly membershipRepository: MembershipRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /**
   * Days until a new invitation expires (`tenancyConfigSpec`'s
   * `invitationExpiryDays`, E05-T06, default 7). Section 7: the *policy*
   * value is read here, in the use case; `expiresAt` is computed here too
   * — `Invitation.create` (E05-T05) only ever validates the resulting
   * instant, it never computes one itself.
   */
  readonly invitationExpiryDays: number;
}

/**
 * Runs `fn`, converting a thrown `ValidationError` into `Err`. Anything
 * else rethrows. Same helper `createOrganization` (E05-T03) uses — only
 * the domain layer's own expected-failure type is bridged into `Result`
 * space here.
 */
function tryDomain<T>(fn: () => T): Result<T, ValidationError> {
  try {
    return ok(fn());
  } catch (error) {
    if (error instanceof ValidationError) return err(error);
    throw error;
  }
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MILLISECONDS_PER_DAY);
}

/**
 * The `InviteMember` use case (E05-T06, authorization added E05-T07) —
 * the second real application service in `@corestack/tenancy`.
 * Coordinates the `Organization` (existence/status check only — no
 * mutation), `Membership` (the inviter's own, for authorization — see
 * Section 8 below; the invitee's is deliberately not checked, see the
 * skipped-check note further down), and `Invitation` (E05-T05) aggregates
 * through `OrganizationRepository`/`MembershipRepository`/
 * `InvitationRepository` and `UnitOfWork` event publication, exactly like
 * `createOrganization` (E05-T03) coordinates `Organization` alone.
 * Contains no domain rules of its own — every invariant (email format,
 * owner-role lock, expiry-in-the-future, the status machine) lives in
 * `Invitation` and its value objects; the inviter-authorization matrix
 * (`canInviteAs`, `invite-authorization.ts`) is orchestration logic, not a
 * domain rule of any aggregate.
 *
 * **E05-T07 Section 8 closes an authorization gap this use case's own
 * E05-T06 documentation flagged explicitly**: until this task, any caller
 * holding a valid `OrgScopedContext` for an organization could invite
 * into it regardless of their own membership or role. Now the inviter's
 * own `ACTIVE` membership is looked up (`membershipRepository.findByUserId`)
 * and checked against `canInviteAs`: only `OWNER`/`ADMIN` may invite,
 * `ADMIN` may not invite another `ADMIN`, and nobody may invite `OWNER`
 * (already excluded earlier via `CannotInviteOwnerError`, so
 * `canInviteAs`'s own `OWNER` rejection is defense-in-depth here too).
 *
 * **Never trusts a client-claimed `organizationId` for tenant scoping**
 * (`docs/security/how-to-build-a-tenant-safe-feature.md`, step 1): the
 * `context: OrgScopedContext` parameter is the authoritative,
 * server-resolved scope, resolved by the caller before this function is
 * invoked. `command.organizationId` is still a real field (Section 3
 * requires it), but it is checked for exact equality against
 * `context.organizationId` and rejected with `ForbiddenError` on
 * mismatch — it is never used to *construct* scope, only to confirm the
 * caller's command agrees with the context they were already given. This
 * is the same kind of two-field-same-identity tension
 * `create-organization-usecase.md` documents for `requestedBy` vs.
 * `context.actor.id`, resolved the same way: one field is authoritative,
 * the other is checked against it, not blindly trusted.
 *
 * The entire flow runs inside one `UnitOfWork.run()` call (Section 4).
 * **Not a hard duplicate-invitation guarantee**: like `existsBySlug`
 * (E05-T03), `existsPendingForEmail` is a best-effort check until E05-T21
 * adds a real uniqueness constraint.
 */
export async function inviteMember(
  context: OrgScopedContext,
  command: InviteMemberCommand,
  deps: InviteMemberDeps,
): Promise<
  Result<
    InviteMemberResult,
    | ValidationError
    | ForbiddenError
    | NotFoundError
    | ConflictError
    | CannotInviteOwnerError
    | InvitationAlreadyExistsError
    | InviterNotAuthorizedError
  >
> {
  return deps.uow.run(async (tx) => {
    const organizationIdResult = tryDomain(() =>
      OrganizationId.from(command.organizationId.trim()),
    );
    if (!organizationIdResult.ok) return organizationIdResult;
    const organizationId = organizationIdResult.value;

    if (organizationId.value !== context.organizationId) {
      return err(
        new ForbiddenError(
          "command organizationId does not match the resolved organization context",
          {
            metadata: {
              commandOrganizationId: organizationId.value,
              contextOrganizationId: context.organizationId,
            },
          },
        ),
      );
    }

    // Section 3: "trim email, normalise email through Email value object" —
    // delegated to Email.from, not re-implemented here.
    const emailResult = tryDomain(() => Email.from(command.email.trim()));
    if (!emailResult.ok) return emailResult;
    const email = emailResult.value;

    // Section 5: fail before aggregate creation, with a dedicated error
    // type. Invitation.create's own assertValidInvitationRole rejects
    // "OWNER" too (defense-in-depth), but a caller of this use case
    // should never actually reach that generic path.
    if (command.role === "OWNER") {
      return err(new CannotInviteOwnerError());
    }

    // Validated here (not just deferred to Invitation.create) so the
    // E05-T07 authorization check below has a properly-typed InvitationRole
    // to pass to canInviteAs, rather than an unchecked raw string.
    const roleResult = tryDomain(() => assertValidInvitationRole(command.role));
    if (!roleResult.ok) return roleResult;
    const role = roleResult.value;

    const invitedByResult = tryDomain(() => UserId.from(command.invitedBy.trim()));
    if (!invitedByResult.ok) return invitedByResult;
    const invitedBy = invitedByResult.value;

    const requestId = command.requestId.trim();
    if (requestId.length === 0) {
      return err(
        new ValidationError("requestId must not be empty", { metadata: { field: "requestId" } }),
      );
    }

    // Section 4 step 1: organization must exist and be ACTIVE.
    const organization = await deps.organizationRepository.findById(
      context,
      organizationId.value,
    );
    if (organization === null) {
      return err(
        new NotFoundError(`organization "${organizationId.value}" not found`, {
          metadata: { organizationId: organizationId.value },
        }),
      );
    }
    if (organization.status !== OrganizationStatus.Active) {
      return err(
        new ConflictError(
          `organization "${organizationId.value}" is not ACTIVE (status: ${organization.status})`,
          { metadata: { organizationId: organizationId.value, status: organization.status } },
        ),
      );
    }

    // Section 4 step 2 (active-membership check for the invitee) is
    // deliberately skipped here: Membership keys off userId, not email,
    // and no email->userId directory (no User aggregate/repository)
    // exists anywhere in this codebase. "Verify ... if the repository can
    // determine it" (Section 4) is the directive's own out for exactly
    // this case — see docs/modules/invite-member-usecase.md's non-goals
    // for the full reasoning. This is unrelated to the inviter-
    // authorization check immediately below: that one looks up the
    // *inviter's* membership (keyed by userId, which the inviter's own id
    // already is), not the invitee's.

    // E05-T07 Section 8: the inviter must have a role that permits
    // inviting the requested target role. Closes the authorization gap
    // E05-T06 flagged explicitly: until this task, any caller holding a
    // valid OrgScopedContext for an organization could invite into it
    // regardless of their own membership or role.
    const inviterMembership = await deps.membershipRepository.findByUserId(
      context,
      invitedBy.value,
    );
    if (
      inviterMembership === null ||
      inviterMembership.status !== MembershipStatus.Active ||
      !canInviteAs(inviterMembership.role, role)
    ) {
      return err(new InviterNotAuthorizedError(invitedBy.value, organizationId.value, role));
    }

    // Section 4 step 3 / Section 5: duplicate-pending-invitation check.
    const alreadyPending = await deps.invitationRepository.existsPendingForEmail(context, email);
    if (alreadyPending) {
      return err(new InvitationAlreadyExistsError(email.value, organizationId.value));
    }

    const now = deps.clock.now();
    const invitationResult = tryDomain(() =>
      Invitation.create({
        id: deps.ids.generate(),
        organizationId: organizationId.value,
        email: email.value,
        role,
        invitedBy: invitedBy.value,
        now,
        expiresAt: addDays(now, deps.invitationExpiryDays),
      }),
    );
    if (!invitationResult.ok) return invitationResult;
    const invitation = invitationResult.value;

    await deps.invitationRepository.save(context, invitation);

    for (const event of invitation.pullDomainEvents()) {
      // Invitation.create() only ever emits InvitationCreated. The other
      // InvitationDomainEvent types (Accepted/Revoked/Expired) belong to
      // whichever future use case calls those aggregate methods, not
      // this one.
      if (event.type !== "InvitationCreated") continue;
      tx.publish(
        createEvent<InvitationCreatedPayload>(
          {
            name: INVITATION_CREATED_EVENT,
            version: 1,
            organizationId: event.organizationId,
            payload: {
              invitationId: event.invitationId,
              organizationId: event.organizationId,
              email: event.email,
              role: event.role,
              invitedBy: event.invitedBy,
              expiresAt: event.expiresAt.toISOString(),
            },
          },
          context,
          deps,
        ),
      );
    }
    invitation.clearDomainEvents();

    return ok({
      invitationId: invitation.id.value,
      organizationId: invitation.organizationId.value,
      email: invitation.email.value,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    });
  });
}
