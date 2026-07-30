import { ConflictError, ValidationError } from "@corestack/kernel";

import { MembershipId } from "./membership-id.js";
import { OrganizationId } from "./organization-id.js";
import { UserId } from "./user-id.js";
import { MembershipRole, isLegalMembershipRoleTransition } from "./membership-role.js";
import {
  MembershipStatus,
  isLegalMembershipStatusTransition,
} from "./membership-status.js";
import type { MembershipDomainEvent } from "./membership-events.js";

export interface CreateMembershipInput {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: MembershipRole;
  /** Caller-supplied timestamp — the aggregate never reads the wall clock itself, same convention as `Organization.create` (E05-T02). */
  readonly now: Date;
}

/** Full persisted state — every field this aggregate carries, as plain values. No `now`: unlike `create`, reconstitution has no "current instant" of its own. */
export interface ReconstituteMembershipInput {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: MembershipRole;
  readonly status: MembershipStatus;
  readonly joinedAt: Date;
  readonly updatedAt: Date;
  readonly removedAt: Date | null;
}

/**
 * The `Membership` aggregate (E05-T04) — a pure domain model with no
 * persistence, no I/O, and no kernel *port* dependency, following exactly
 * the pattern `Organization` (E05-T02) established: private (`#`) fields
 * with no public setters, explicit transition methods, and
 * `pullDomainEvents()`/`clearDomainEvents()` for event collection
 * (Section 9 — no shared `AggregateRoot` abstraction introduced).
 *
 * Represents one user's relationship to one organization: a role
 * (`OWNER`/`ADMIN`/`MEMBER`) and a lifecycle status (`ACTIVE`/`SUSPENDED`/
 * `REMOVED`). The two are independent axes — suspending or reactivating a
 * membership never changes its role, and promoting/demoting never changes
 * its status.
 */
export class Membership {
  readonly #id: MembershipId;
  readonly #organizationId: OrganizationId;
  readonly #userId: UserId;
  #role: MembershipRole;
  #status: MembershipStatus;
  readonly #joinedAt: Date;
  #updatedAt: Date;
  #removedAt: Date | null;
  #domainEvents: MembershipDomainEvent[];

  private constructor(
    id: MembershipId,
    organizationId: OrganizationId,
    userId: UserId,
    role: MembershipRole,
    status: MembershipStatus,
    joinedAt: Date,
    updatedAt: Date,
    removedAt: Date | null,
  ) {
    this.#id = id;
    this.#organizationId = organizationId;
    this.#userId = userId;
    this.#role = role;
    this.#status = status;
    this.#joinedAt = joinedAt;
    this.#updatedAt = updatedAt;
    this.#removedAt = removedAt;
    this.#domainEvents = [];
  }

  /** Creates a new, `ACTIVE` membership at the given role and records `MembershipCreated`. */
  static create(input: CreateMembershipInput): Membership {
    const id = MembershipId.from(input.id);
    const organizationId = OrganizationId.from(input.organizationId);
    const userId = UserId.from(input.userId);

    const membership = new Membership(
      id,
      organizationId,
      userId,
      input.role,
      MembershipStatus.Active,
      input.now,
      input.now,
      null,
    );
    membership.#domainEvents.push({
      type: "MembershipCreated",
      membershipId: id.value,
      organizationId: organizationId.value,
      occurredAt: input.now,
      userId: userId.value,
      role: input.role,
    });
    return membership;
  }

  /**
   * Rebuilds a `Membership` from its full persisted state (E05-T11) —
   * emits **no** domain event, and does not re-validate creation-time
   * invariants. See `Organization.reconstitute`'s doc comment for the
   * full rationale, shared verbatim across all three aggregates.
   */
  static reconstitute(input: ReconstituteMembershipInput): Membership {
    return new Membership(
      MembershipId.from(input.id),
      OrganizationId.from(input.organizationId),
      UserId.from(input.userId),
      input.role,
      input.status,
      input.joinedAt,
      input.updatedAt,
      input.removedAt,
    );
  }

  get id(): MembershipId {
    return this.#id;
  }

  get organizationId(): OrganizationId {
    return this.#organizationId;
  }

  get userId(): UserId {
    return this.#userId;
  }

  get role(): MembershipRole {
    return this.#role;
  }

  get status(): MembershipStatus {
    return this.#status;
  }

  get joinedAt(): Date {
    return new Date(this.#joinedAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.#updatedAt.getTime());
  }

  /** `null` unless `status` is `REMOVED`. */
  get removedAt(): Date | null {
    return this.#removedAt === null ? null : new Date(this.#removedAt.getTime());
  }

  /**
   * Invariant: a removed membership cannot change (Section 8) — enforced
   * here for the two role-transition methods, which have no entry in the
   * status transition table to fail against on their own (mirrors
   * `Organization#assertNotDeleted` guarding `rename`).
   */
  #assertNotRemoved(operation: string): void {
    if (this.#status === MembershipStatus.Removed) {
      throw new ConflictError(`cannot ${operation} a removed membership`, {
        metadata: { membershipId: this.#id.value, operation },
      });
    }
  }

  /**
   * Invariant: timestamps are monotonic (Section 8) — a caller-supplied
   * `now` earlier than the aggregate's last `updatedAt` is rejected.
   */
  #assertMonotonic(now: Date): void {
    if (now.getTime() < this.#updatedAt.getTime()) {
      throw new ValidationError(
        "timestamp must not precede the membership's last update",
        {
          metadata: {
            membershipId: this.#id.value,
            updatedAt: this.#updatedAt.toISOString(),
            attempted: now.toISOString(),
          },
        },
      );
    }
  }

  #transitionRole(to: MembershipRole, now: Date): MembershipRole {
    if (!isLegalMembershipRoleTransition(this.#role, to)) {
      throw new ConflictError(
        `cannot change membership role from ${this.#role} to ${to}`,
        { metadata: { membershipId: this.#id.value, from: this.#role, to } },
      );
    }
    this.#assertMonotonic(now);
    const previousRole = this.#role;
    this.#role = to;
    this.#updatedAt = now;
    return previousRole;
  }

  /**
   * `MEMBER` → `ADMIN`. Illegal from `OWNER` (Section 4: an owner cannot
   * be downgraded through this aggregate — promoting an owner would in
   * fact be a downgrade) and illegal from `ADMIN` (already an admin is an
   * invalid self-transition, not a no-op). Ownership transfer is a
   * separate, future use case (Section 15) — not implemented here.
   */
  promoteToAdmin(now: Date): void {
    this.#assertNotRemoved("promote");
    const previousRole = this.#transitionRole(MembershipRole.Admin, now);
    this.#domainEvents.push({
      type: "MembershipPromoted",
      membershipId: this.#id.value,
      organizationId: this.#organizationId.value,
      occurredAt: now,
      previousRole,
      role: MembershipRole.Admin,
    });
  }

  /**
   * `ADMIN` → `MEMBER`. Illegal from `OWNER` (an owner cannot be demoted
   * through this aggregate) and illegal from `MEMBER` (already a member is
   * an invalid self-transition, not a no-op).
   */
  demoteToMember(now: Date): void {
    this.#assertNotRemoved("demote");
    const previousRole = this.#transitionRole(MembershipRole.Member, now);
    this.#domainEvents.push({
      type: "MembershipDemoted",
      membershipId: this.#id.value,
      organizationId: this.#organizationId.value,
      occurredAt: now,
      previousRole,
      role: MembershipRole.Member,
    });
  }

  #transitionStatus(to: MembershipStatus, now: Date): void {
    if (!isLegalMembershipStatusTransition(this.#status, to)) {
      throw new ConflictError(
        `cannot transition membership from ${this.#status} to ${to}`,
        { metadata: { membershipId: this.#id.value, from: this.#status, to } },
      );
    }
    this.#assertMonotonic(now);
    this.#status = to;
    this.#updatedAt = now;
  }

  /** `ACTIVE` → `SUSPENDED`. Already-`SUSPENDED` (or `REMOVED`) is an illegal transition, not a no-op. Role is untouched — an owner can be suspended. */
  suspend(now: Date): void {
    this.#transitionStatus(MembershipStatus.Suspended, now);
    this.#domainEvents.push({
      type: "MembershipSuspended",
      membershipId: this.#id.value,
      organizationId: this.#organizationId.value,
      occurredAt: now,
    });
  }

  /** `SUSPENDED` → `ACTIVE`. Already-`ACTIVE` (or `REMOVED`) is an illegal transition, not a no-op. */
  reactivate(now: Date): void {
    this.#transitionStatus(MembershipStatus.Active, now);
    this.#domainEvents.push({
      type: "MembershipReactivated",
      membershipId: this.#id.value,
      organizationId: this.#organizationId.value,
      occurredAt: now,
    });
  }

  /**
   * `ACTIVE`/`SUSPENDED` → `REMOVED`. `REMOVED` is terminal. Section 4: an
   * owner cannot be removed through this aggregate — checked *before* the
   * status transition table, since removal-of-an-owner is illegal
   * regardless of current status, not merely absent from the table.
   */
  remove(now: Date): void {
    if (this.#role === MembershipRole.Owner) {
      throw new ConflictError("cannot remove a membership with the OWNER role", {
        metadata: { membershipId: this.#id.value },
      });
    }
    this.#transitionStatus(MembershipStatus.Removed, now);
    this.#removedAt = now;
    this.#domainEvents.push({
      type: "MembershipRemoved",
      membershipId: this.#id.value,
      organizationId: this.#organizationId.value,
      occurredAt: now,
    });
  }

  /**
   * Returns every domain event recorded since the last `clearDomainEvents()`
   * (or since construction). Non-destructive.
   */
  pullDomainEvents(): readonly MembershipDomainEvent[] {
    return [...this.#domainEvents];
  }

  clearDomainEvents(): void {
    this.#domainEvents = [];
  }
}
