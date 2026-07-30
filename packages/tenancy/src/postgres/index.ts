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
