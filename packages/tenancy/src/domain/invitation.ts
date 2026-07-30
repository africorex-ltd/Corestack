import { ConflictError, ValidationError } from "@corestack/kernel";

import { InvitationId } from "./invitation-id.js";
import { OrganizationId } from "./organization-id.js";
import { UserId } from "./user-id.js";
import { Email } from "./email.js";
import { assertValidInvitationRole } from "./invitation-role.js";
import type { InvitationRole } from "./invitation-role.js";
import {
  InvitationStatus,
  isLegalInvitationStatusTransition,
} from "./invitation-status.js";
import type { InvitationDomainEvent } from "./invitation-events.js";

export interface CreateInvitationInput {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  /** Raw string, runtime-validated by `assertValidInvitationRole` — see that function's own doc for why this differs from `Membership.create`'s already-typed `role` parameter. */
  readonly role: string;
  readonly invitedBy: string;
  /** Caller-supplied timestamp — the aggregate never reads the wall clock itself, same convention as `Organization.create`/`Membership.create`. */
  readonly now: Date;
  /** Must be strictly after `now` (Section 7: "expiresAt must be in the future at creation"). The *duration* policy (e.g. "72 hours") is an application-layer/config concern (`tenancyConfigSpec`'s `invitationExpiryHours`, E05-T01) — this aggregate only validates the resulting instant, it does not compute one. */
  readonly expiresAt: Date;
}

/**
 * The `Invitation` aggregate (E05-T05) — a pure domain model with no
 * persistence, no I/O, and no kernel *port* dependency, following exactly
 * the pattern `Organization` (E05-T02) and `Membership` (E05-T04)
 * established: private (`#`) fields with no public setters, explicit
 * transition methods, and `pullDomainEvents()`/`clearDomainEvents()` for
 * event collection (Section 9 — no shared `AggregateRoot` abstraction).
 *
 * Represents pending access to an organization, offered to an email
 * address at a given role. `PENDING` is the only mutable state — the
 * three terminal outcomes (`ACCEPTED`/`REVOKED`/`EXPIRED`) are dead ends,
 * mirroring `OrganizationStatus.Deleted`/`MembershipStatus.Removed`
 * except there are three terminal states here instead of one.
 *
 * Deliberately has **no** token/secret field. Section 13/14: token
 * generation, hashing, and delivery are infrastructure/application
 * concerns for a future task, not this domain model's job — see
 * "Non-goals" in `docs/modules/invitation-domain.md`.
 */
export class Invitation {
  readonly #id: InvitationId;
  readonly #organizationId: OrganizationId;
  readonly #email: Email;
  readonly #role: InvitationRole;
  #status: InvitationStatus;
  readonly #invitedBy: UserId;
  readonly #createdAt: Date;
  readonly #expiresAt: Date;
  #respondedAt: Date | null;
  #domainEvents: InvitationDomainEvent[];

  private constructor(
    id: InvitationId,
    organizationId: OrganizationId,
    email: Email,
    role: InvitationRole,
    status: InvitationStatus,
    invitedBy: UserId,
    createdAt: Date,
    expiresAt: Date,
    respondedAt: Date | null,
  ) {
    this.#id = id;
    this.#organizationId = organizationId;
    this.#email = email;
    this.#role = role;
    this.#status = status;
    this.#invitedBy = invitedBy;
    this.#createdAt = createdAt;
    this.#expiresAt = expiresAt;
    this.#respondedAt = respondedAt;
    this.#domainEvents = [];
  }

  /**
   * Creates a new `PENDING` invitation and records `InvitationCreated`.
   * Invariant (Section 7): `expiresAt` must be strictly after `now` — an
   * invitation that is already-expired at creation is rejected outright,
   * not silently accepted and left for a future `expire()` call to clean
   * up.
   */
  static create(input: CreateInvitationInput): Invitation {
    const id = InvitationId.from(input.id);
    const organizationId = OrganizationId.from(input.organizationId);
    const email = Email.from(input.email);
    const role = assertValidInvitationRole(input.role);
    const invitedBy = UserId.from(input.invitedBy);

    if (input.expiresAt.getTime() <= input.now.getTime()) {
      throw new ValidationError("expiresAt must be strictly after now", {
        metadata: {
          now: input.now.toISOString(),
          expiresAt: input.expiresAt.toISOString(),
        },
      });
    }

    const invitation = new Invitation(
      id,
      organizationId,
      email,
      role,
      InvitationStatus.Pending,
      invitedBy,
      input.now,
      input.expiresAt,
      null,
    );
    invitation.#domainEvents.push({
      type: "InvitationCreated",
      invitationId: id.value,
      organizationId: organizationId.value,
      occurredAt: input.now,
      email: email.value,
      role,
      invitedBy: invitedBy.value,
      expiresAt: input.expiresAt,
    });
    return invitation;
  }

  get id(): InvitationId {
    return this.#id;
  }

  get organizationId(): OrganizationId {
    return this.#organizationId;
  }

  get email(): Email {
    return this.#email;
  }

  get role(): InvitationRole {
    return this.#role;
  }

  get status(): InvitationStatus {
    return this.#status;
  }

  get invitedBy(): UserId {
    return this.#invitedBy;
  }

  get createdAt(): Date {
    return new Date(this.#createdAt.getTime());
  }

  get expiresAt(): Date {
    return new Date(this.#expiresAt.getTime());
  }

  /** `null` while `status` is `PENDING`; set exactly once, by whichever terminal transition fires first (see `#transitionStatus`). */
  get respondedAt(): Date | null {
    return this.#respondedAt === null ? null : new Date(this.#respondedAt.getTime());
  }

  /**
   * Invariant: timestamps are monotonic (Section 7). There is no
   * `updatedAt` field on this aggregate (Section 6's field list has none
   * — `PENDING` is the only mutable state, and every terminal transition
   * is a one-way, one-time event), so the baseline to check against is
   * `createdAt` itself: a terminal transition's `now` must not precede
   * the invitation's own creation.
   */
  #assertMonotonic(now: Date): void {
    if (now.getTime() < this.#createdAt.getTime()) {
      throw new ValidationError("timestamp must not precede the invitation's creation", {
        metadata: {
          invitationId: this.#id.value,
          createdAt: this.#createdAt.toISOString(),
          attempted: now.toISOString(),
        },
      });
    }
  }

  /**
   * Invariant: terminal invitations cannot change (Section 7). Since
   * `ACCEPTED`/`REVOKED`/`EXPIRED` each have an empty outgoing-transition
   * list, this single check — shared by `accept`/`revoke`/`expire` —
   * covers all three terminal states at once, and structurally guarantees
   * `respondedAt` is set exactly once: once any of the three fires, every
   * subsequent call to any of them fails here before `respondedAt` could
   * be reassigned.
   */
  #transitionStatus(to: InvitationStatus, now: Date): void {
    if (!isLegalInvitationStatusTransition(this.#status, to)) {
      throw new ConflictError(`cannot transition invitation from ${this.#status} to ${to}`, {
        metadata: { invitationId: this.#id.value, from: this.#status, to },
      });
    }
    this.#assertMonotonic(now);
    this.#status = to;
    this.#respondedAt = now;
  }

  /** `PENDING` → `ACCEPTED`. Illegal from any terminal state — accepting twice, or accepting a revoked/expired invitation, both throw. */
  accept(now: Date): void {
    this.#transitionStatus(InvitationStatus.Accepted, now);
    this.#domainEvents.push({
      type: "InvitationAccepted",
      invitationId: this.#id.value,
      organizationId: this.#organizationId.value,
      occurredAt: now,
    });
  }

  /** `PENDING` → `REVOKED`. Illegal from any terminal state. */
  revoke(now: Date): void {
    this.#transitionStatus(InvitationStatus.Revoked, now);
    this.#domainEvents.push({
      type: "InvitationRevoked",
      invitationId: this.#id.value,
      organizationId: this.#organizationId.value,
      occurredAt: now,
    });
  }

  /**
   * `PENDING` → `EXPIRED`. Illegal from any terminal state. Deliberately
   * does **not** compare `now` against `expiresAt` itself — deciding
   * *when* an invitation has expired is a policy call for whichever
   * future use case calls this method (e.g. a scheduled sweep comparing
   * against `expiresAt`); this aggregate only provides the capability to
   * record the fact once that decision has been made elsewhere, the same
   * division of responsibility `Organization.delete`/`Membership.remove`
   * use for their own terminal transitions.
   */
  expire(now: Date): void {
    this.#transitionStatus(InvitationStatus.Expired, now);
    this.#domainEvents.push({
      type: "InvitationExpired",
      invitationId: this.#id.value,
      organizationId: this.#organizationId.value,
      occurredAt: now,
    });
  }

  /**
   * Returns every domain event recorded since the last `clearDomainEvents()`
   * (or since construction). Non-destructive.
   */
  pullDomainEvents(): readonly InvitationDomainEvent[] {
    return [...this.#domainEvents];
  }

  clearDomainEvents(): void {
    this.#domainEvents = [];
  }
}
