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

export type { MembershipRecord } from "./domain/membership.js";
export type { InvitationRecord } from "./domain/invitation.js";

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
} from "./application/events.js";
export type {
  OrganizationCreatedPayload,
  OrganizationUpdatedPayload,
  OrganizationDeletedPayload,
  MemberJoinedPayload,
  MemberUpdatedPayload,
  MemberRemovedPayload,
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
