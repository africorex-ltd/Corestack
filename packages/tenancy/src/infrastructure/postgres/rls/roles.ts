/**
 * The two ADR-0008 tenancy roles (app / platform) for this module,
 * following `examples/acme-crm-module`'s exact naming convention
 * (`acme_crm_app`/`acme_crm_platform`). Not to be confused with
 * `@corestack/platform`'s `ensureTenancyRoles`/`TenancyRoleNames` — those
 * names describe the generic ADR-0008 *concept* ("tenancy roles" as in
 * "the roles the tenant-isolation RLS harness introduced"), not this
 * specific module. A `tenancy_app`/`tenancy_platform` pair is this
 * module's own instance of that generic concept, same as
 * `acme_crm_app`/`acme_crm_platform` is acme-crm's.
 */
export const TENANCY_APP_ROLE = "tenancy_app";
export const TENANCY_PLATFORM_ROLE = "tenancy_platform";
