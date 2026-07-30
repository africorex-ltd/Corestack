export { Organization } from "./domain/organization.js";
export type { CreateOrganizationInput } from "./domain/organization.js";

export { OrganizationId } from "./domain/organization-id.js";
export { OrganizationSlug } from "./domain/organization-slug.js";

export {
  OrganizationStatus,
  isLegalOrganizationStatusTransition,
} from "./domain/organization-status.js";

export type {
  OrganizationDomainEvent,
  OrganizationCreatedEvent,
  OrganizationRenamedEvent,
  OrganizationSuspendedEvent,
  OrganizationReactivatedEvent,
  OrganizationDeletedEvent,
} from "./domain/organization-events.js";

export { Membership } from "./domain/membership.js";
export type { CreateMembershipInput } from "./domain/membership.js";

export { MembershipId } from "./domain/membership-id.js";
export { UserId } from "./domain/user-id.js";

export {
  MembershipRole,
  isLegalMembershipRoleTransition,
} from "./domain/membership-role.js";
export {
  MembershipStatus,
  isLegalMembershipStatusTransition,
} from "./domain/membership-status.js";

export type {
  MembershipDomainEvent,
  MembershipCreatedEvent,
  MembershipPromotedEvent,
  MembershipDemotedEvent,
  MembershipSuspendedEvent,
  MembershipReactivatedEvent,
  MembershipRemovedEvent,
} from "./domain/membership-events.js";

export { Invitation } from "./domain/invitation.js";
export type { CreateInvitationInput } from "./domain/invitation.js";

export { InvitationId } from "./domain/invitation-id.js";
export { Email } from "./domain/email.js";

export {
  InvitationRole,
  assertValidInvitationRole,
} from "./domain/invitation-role.js";
export {
  InvitationStatus,
  isLegalInvitationStatusTransition,
} from "./domain/invitation-status.js";

export type {
  InvitationDomainEvent,
  InvitationCreatedEvent,
  InvitationAcceptedEvent,
  InvitationRevokedEvent,
  InvitationExpiredEvent,
} from "./domain/invitation-events.js";

export type { OrganizationRepository } from "./application/organization-repository.js";
export type { MembershipRepository } from "./application/membership-repository.js";
export type { InvitationRepository } from "./application/invitation-repository.js";

export {
  ORGANIZATION_CREATED_EVENT,
  ORGANIZATION_UPDATED_EVENT,
  ORGANIZATION_DELETED_EVENT,
  MEMBER_JOINED_EVENT,
  MEMBER_UPDATED_EVENT,
  MEMBER_REMOVED_EVENT,
  INVITATION_CREATED_EVENT,
} from "./application/events.js";
export type {
  OrganizationCreatedPayload,
  OrganizationUpdatedPayload,
  OrganizationDeletedPayload,
  MemberJoinedPayload,
  MemberUpdatedPayload,
  MemberRemovedPayload,
  InvitationCreatedPayload,
} from "./application/events.js";

export type { TenancyConfig, ResolvedTenancyConfig } from "./application/config.js";
export {
  DEFAULT_TENANCY_CONFIG,
  tenancyConfigSpec,
  withTenancyConfigDefaults,
  resolveTenancyConfig,
} from "./application/config.js";

export type { TenancyModuleDeps, TenancyUseCases } from "./application/module.js";
export { createTenancyModule } from "./application/module.js";

export { DuplicateSlugError } from "./application/duplicate-slug-error.js";

export type {
  CreateOrganizationCommand,
  CreateOrganizationResult,
  CreateOrganizationDeps,
} from "./application/create-organization.js";
export { createOrganization } from "./application/create-organization.js";

export { CannotInviteOwnerError } from "./application/cannot-invite-owner-error.js";
export { InvitationAlreadyExistsError } from "./application/invitation-already-exists-error.js";

export type {
  InviteMemberCommand,
  InviteMemberResult,
  InviteMemberDeps,
} from "./application/invite-member.js";
export { inviteMember } from "./application/invite-member.js";
