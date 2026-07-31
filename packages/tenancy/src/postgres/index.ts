/**
 * `@corestack/tenancy/postgres` — the reference Postgres adapters
 * (E05-T11). Subpath export (mirroring `@corestack/platform/postgres`,
 * ADR-0010): `drizzle-orm`/`postgres` are optional peer dependencies —
 * the main `.` entry point never pulls them in; only an adopter that
 * imports from this path does.
 */

export { PostgresOrganizationRepository } from "../infrastructure/postgres/postgres-organization-repository.js";
export { PostgresMembershipRepository } from "../infrastructure/postgres/postgres-membership-repository.js";
export { PostgresInvitationRepository } from "../infrastructure/postgres/postgres-invitation-repository.js";

export { ensureTenancyModuleRoles } from "../infrastructure/postgres/ensure-tenancy-postgres-roles.js";
export { TENANCY_APP_ROLE, TENANCY_PLATFORM_ROLE } from "../infrastructure/postgres/rls/roles.js";
export {
  buildOrgScopedTableRlsDdl,
  buildOrganizationsRlsDdl,
} from "../infrastructure/postgres/rls/index.js";

export {
  toOrganization,
  toOrganizationRow,
  type OrganizationRow,
  type OrganizationRowValues,
} from "../infrastructure/postgres/mappers/organization-mapper.js";
export {
  toMembership,
  toMembershipRow,
  type MembershipRow,
  type MembershipRowValues,
} from "../infrastructure/postgres/mappers/membership-mapper.js";
export {
  toInvitation,
  toInvitationRow,
  type InvitationRow,
  type InvitationRowValues,
} from "../infrastructure/postgres/mappers/invitation-mapper.js";

export {
  isUniqueViolation,
  uniqueViolationConstraintName,
} from "../infrastructure/postgres/constraint-violation.js";

export {
  toNotificationWorkItem,
  toNotificationWorkItemRow,
  type NotificationWorkItemRow,
  type NotificationWorkItemRowValues,
} from "../infrastructure/postgres/mappers/notification-work-item-mapper.js";
export { PostgresNotificationWorkItemRepository } from "../infrastructure/postgres/postgres-notification-work-item-repository.js";
export {
  createInvitationNotificationSubscription,
  INVITATION_NOTIFICATION_CONSUMER,
  type InvitationNotificationConsumerDeps,
} from "../infrastructure/postgres/invitation-notification-consumer.js";
export {
  processNextNotificationWorkItem,
  type NotificationProcessingDeps,
  type NotificationProcessingResult,
} from "../infrastructure/postgres/process-notification-work-item.js";

export {
  toNotificationDeliveryPayload,
  toNotificationDeliveryPayloadRow,
  type NotificationDeliveryPayloadRow,
  type NotificationDeliveryPayloadRowValues,
} from "../infrastructure/postgres/mappers/notification-delivery-payload-mapper.js";
export { PostgresNotificationDeliveryPayloadRepository } from "../infrastructure/postgres/postgres-notification-delivery-payload-repository.js";
export {
  deliverNotificationWorkItemAsJsonPayload,
  type NotificationPayloadDeliveryDeps,
  type NotificationPayloadDeliveryResult,
} from "../infrastructure/postgres/notification-payload-delivery-adapter.js";
