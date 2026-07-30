/**
 * Membership domain events — E05-T04 Section 7.
 *
 * Same precedent as `OrganizationDomainEvent` (`organization-events.ts`,
 * E05-T02): these are **not** kernel `DomainEvent`s. No `actor`,
 * `correlationId`, `causationId`, generated `id`, or contract `version` —
 * the aggregate has no `Context` and no `IdGenerator`. Just the fact that
 * something happened, with the aggregate's own id and the timestamp it was
 * given. Mapping these to the wire-level contract already defined in
 * `../application/events.ts` (`MEMBER_JOINED_EVENT`, etc., E05-T01) is a
 * future use case's job, following the exact pattern E05-T03's
 * `createOrganization` established for `OrganizationCreated`. Not built
 * here — no use case exists yet (Section 2).
 */

import type { MembershipRole } from "./membership-role.js";

export interface MembershipCreatedEvent {
  readonly type: "MembershipCreated";
  readonly membershipId: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
  readonly userId: string;
  readonly role: MembershipRole;
}

export interface MembershipPromotedEvent {
  readonly type: "MembershipPromoted";
  readonly membershipId: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
  readonly previousRole: MembershipRole;
  readonly role: MembershipRole;
}

export interface MembershipDemotedEvent {
  readonly type: "MembershipDemoted";
  readonly membershipId: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
  readonly previousRole: MembershipRole;
  readonly role: MembershipRole;
}

export interface MembershipSuspendedEvent {
  readonly type: "MembershipSuspended";
  readonly membershipId: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
}

export interface MembershipReactivatedEvent {
  readonly type: "MembershipReactivated";
  readonly membershipId: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
}

export interface MembershipRemovedEvent {
  readonly type: "MembershipRemoved";
  readonly membershipId: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
}

export type MembershipDomainEvent =
  | MembershipCreatedEvent
  | MembershipPromotedEvent
  | MembershipDemotedEvent
  | MembershipSuspendedEvent
  | MembershipReactivatedEvent
  | MembershipRemovedEvent;
