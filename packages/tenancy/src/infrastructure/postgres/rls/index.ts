/**
 * RLS policy DDL generators for the tenancy schema (E05-T10). Re-exported
 * from the package's `./postgres` subpath (E05-T11,
 * `src/postgres/index.ts`) now that `PostgresOrganizationRepository`/
 * `PostgresMembershipRepository`/`PostgresInvitationRepository` are real
 * consumers. See `docs/modules/tenancy-rls-design.md`.
 */
export { TENANCY_APP_ROLE, TENANCY_PLATFORM_ROLE } from "./roles.js";
export { buildOrgScopedTableRlsDdl } from "./org-scoped-table-policies.js";
export { buildOrganizationsRlsDdl } from "./organizations-policies.js";
