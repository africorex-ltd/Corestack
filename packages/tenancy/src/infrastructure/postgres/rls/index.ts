/**
 * RLS policy DDL generators for the tenancy schema (E05-T10). Internal to
 * this package for now, same posture as `../schema/` (E05-T09) — no
 * `./postgres` package export yet, since no repository adapter consumes
 * this. See `docs/modules/tenancy-rls-design.md`.
 */
export { TENANCY_APP_ROLE, TENANCY_PLATFORM_ROLE } from "./roles.js";
export { buildOrgScopedTableRlsDdl } from "./org-scoped-table-policies.js";
export { buildOrganizationsRlsDdl } from "./organizations-policies.js";
