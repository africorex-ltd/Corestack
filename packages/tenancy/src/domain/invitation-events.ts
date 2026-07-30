/**
 * Invitation domain events — E05-T05 Section 8.
 *
 * Same precedent as `OrganizationDomainEvent`/`MembershipDomainEvent`:
 * not kernel `DomainEvent`s — no `actor`, `correlationId`, `causationId`,
 * generated `id`, or contract `version`. The aggregate has no `Context`
 * and no `IdGenerator`. Unlike `Organization`/`Membership`, no wire-level
 * contract (`INVITATION_*` event name constants) exists yet in
 * `../application/events.ts` — E05-T01 only defined organization and
 * member event contracts, not invitation ones. A future task defining
 * `InviteMember`/`AcceptInvitation` will need to add that wire contract
 * *and* the mapping from these domain events onto it, following the
 * pattern E05-T03's `createOrganization` established.
 */

import type { InvitationRole } from "./invitation-role.js";

export interface InvitationCreatedEvent {
  readonly type: "InvitationCreated";
  readonly invitationId: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
  readonly email: string;
  readonly role: InvitationRole;
  readonly invitedBy: string;
  readonly expiresAt: Date;
}

export interface InvitationAcceptedEvent {
  readonly type: "InvitationAccepted";
  readonly invitationId: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
}

export interface InvitationRevokedEvent {
  readonly type: "InvitationRevoked";
  readonly invitationId: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
}

export interface InvitationExpiredEvent {
  readonly type: "InvitationExpired";
  readonly invitationId: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
}

export type InvitationDomainEvent =
  | InvitationCreatedEvent
  | InvitationAcceptedEvent
  | InvitationRevokedEvent
  | InvitationExpiredEvent;
