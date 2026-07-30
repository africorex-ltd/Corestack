/**
 * Tenancy event contracts (E05-T01 Section 8; docs/modules/tenancy-
 * contract.md's "Events" table). Names and payload types only — no
 * publishing logic. Publishing happens inside the real commands (E05-T07
 * onward) that don't exist yet; this file exists so those commands, once
 * written, have an agreed envelope shape to target instead of inventing
 * one ad hoc per command.
 *
 * Every event follows the kernel's existing `DomainEvent` envelope
 * (versioned, JSON-round-trippable) — these types describe `payload` only,
 * not the envelope itself, matching `acme-crm-module`'s
 * `CONTACT_CREATED_EVENT` precedent.
 */

export const ORGANIZATION_CREATED_EVENT = "organization.created";
export const ORGANIZATION_UPDATED_EVENT = "organization.updated";
export const ORGANIZATION_DELETED_EVENT = "organization.deleted";
export const MEMBER_JOINED_EVENT = "member.joined";
export const MEMBER_UPDATED_EVENT = "member.updated";
export const MEMBER_REMOVED_EVENT = "member.removed";

/**
 * `kind` (`personal`/`team`) was dropped from this shape in E05-T03: the
 * `Organization` aggregate (E05-T02) has no `kind` field — see
 * `docs/modules/organization-domain.md`'s non-goals — so a payload
 * requiring it could never actually be constructed from a real
 * `OrganizationCreated` domain event. The wire contract follows the
 * domain model, not the other way around.
 */
export interface OrganizationCreatedPayload {
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
}

export interface OrganizationUpdatedPayload {
  readonly organizationId: string;
  readonly changes: Readonly<Record<string, unknown>>;
}

export interface OrganizationDeletedPayload {
  readonly organizationId: string;
}

export interface MemberJoinedPayload {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly role: "owner" | "admin" | "member";
}

export interface MemberUpdatedPayload {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly changes: Readonly<Record<string, unknown>>;
}

export interface MemberRemovedPayload {
  readonly organizationId: string;
  readonly membershipId: string;
}
