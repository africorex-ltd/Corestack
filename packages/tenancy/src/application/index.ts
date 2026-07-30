export type { OrganizationRepository } from "./organization-repository.js";
export type { MembershipRepository } from "./membership-repository.js";
export type { InvitationRepository } from "./invitation-repository.js";

export {
  ORGANIZATION_CREATED_EVENT,
  ORGANIZATION_UPDATED_EVENT,
  ORGANIZATION_DELETED_EVENT,
  MEMBER_JOINED_EVENT,
  MEMBER_UPDATED_EVENT,
  MEMBER_REMOVED_EVENT,
} from "./events.js";
export type {
  OrganizationCreatedPayload,
  OrganizationUpdatedPayload,
  OrganizationDeletedPayload,
  MemberJoinedPayload,
  MemberUpdatedPayload,
  MemberRemovedPayload,
} from "./events.js";

export type { TenancyConfig, ResolvedTenancyConfig } from "./config.js";
export {
  DEFAULT_TENANCY_CONFIG,
  tenancyConfigSpec,
  withTenancyConfigDefaults,
  resolveTenancyConfig,
} from "./config.js";

export type { TenancyModuleDeps, TenancyUseCases } from "./module.js";
export { createTenancyModule } from "./module.js";

export { DuplicateSlugError } from "./duplicate-slug-error.js";

export type {
  CreateOrganizationCommand,
  CreateOrganizationResult,
  CreateOrganizationDeps,
} from "./create-organization.js";
export { createOrganization } from "./create-organization.js";
