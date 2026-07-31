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
  INVITATION_CREATED_EVENT,
  INVITATION_ACCEPTED_EVENT,
  INVITATION_EXPIRED_EVENT,
} from "./events.js";
export type {
  OrganizationCreatedPayload,
  OrganizationUpdatedPayload,
  OrganizationDeletedPayload,
  MemberJoinedPayload,
  MemberUpdatedPayload,
  MemberRemovedPayload,
  InvitationCreatedPayload,
  InvitationAcceptedPayload,
  InvitationExpiredPayload,
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

export { CannotInviteOwnerError } from "./cannot-invite-owner-error.js";
export { InvitationAlreadyExistsError } from "./invitation-already-exists-error.js";
export { InviterNotAuthorizedError } from "./inviter-not-authorized-error.js";
export { canInviteAs } from "./invite-authorization.js";

export type {
  InviteMemberCommand,
  InviteMemberResult,
  InviteMemberDeps,
} from "./invite-member.js";
export { inviteMember } from "./invite-member.js";

export { InvitationNotFoundError } from "./invitation-not-found-error.js";
export { InvitationExpiredError } from "./invitation-expired-error.js";
export { InvitationNotPendingError } from "./invitation-not-pending-error.js";
export { MembershipAlreadyExistsError } from "./membership-already-exists-error.js";

export type {
  AcceptInvitationCommand,
  AcceptInvitationResult,
  AcceptInvitationDeps,
} from "./accept-invitation.js";
export { acceptInvitation } from "./accept-invitation.js";

export type { OrganizationSummary, GetOrganizationDeps } from "./get-organization-query.js";
export { toOrganizationSummary, getOrganization } from "./get-organization-query.js";

export type {
  OrganizationMemberSummary,
  ListOrganizationMembersDeps,
} from "./list-organization-members-query.js";
export {
  toOrganizationMemberSummary,
  listOrganizationMembers,
} from "./list-organization-members-query.js";

export type {
  PendingInvitationSummary,
  ListPendingInvitationsDeps,
} from "./list-pending-invitations-query.js";
export {
  toPendingInvitationSummary,
  listPendingInvitations,
} from "./list-pending-invitations-query.js";

export type {
  NotificationWorkItem,
  NotificationWorkItemType,
  NotificationWorkItemStatus,
} from "./notification-work-item.js";
export type { NotificationWorkItemRepository } from "./notification-work-item-repository.js";
export type { BuildNotificationWorkItemDeps } from "./build-notification-work-item.js";
export { buildNotificationWorkItemFromEvent } from "./build-notification-work-item.js";
