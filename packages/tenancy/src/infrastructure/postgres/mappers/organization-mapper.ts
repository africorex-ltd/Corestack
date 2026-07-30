import { Organization } from "../../../domain/organization.js";
import type { OrganizationStatus } from "../../../domain/organization-status.js";

/**
 * Raw `tenancy.organizations` row shape, exactly as returned by a plain
 * `SELECT id, slug, name, status, created_at, updated_at, deleted_at`
 * (snake_case column names — this module queries via `postgres`'s tagged
 * templates directly, not Drizzle's query builder; Drizzle is schema/DDL
 * only in this package, per E05-T09/T10's own precedent).
 */
export interface OrganizationRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly deleted_at: Date | null;
}

/**
 * Row → aggregate (E05-T11 Section 7). Explicit field-by-field
 * conversion — no destructuring shortcut that would silently drop a
 * rename mismatch between the column and the aggregate's constructor
 * input. `status` is trusted as `OrganizationStatus` without
 * re-validation: the `organizations_status_check` CHECK constraint
 * (E05-T09) already guarantees it's one of the three legal values,
 * exactly why `Organization.reconstitute` (E05-T11) skips creation-time
 * revalidation.
 */
export function toOrganization(row: OrganizationRow): Organization {
  return Organization.reconstitute({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status as OrganizationStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

/** Plain values for an `INSERT`/`UPDATE` — the aggregate → row direction. */
export interface OrganizationRowValues {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/** Aggregate → row (E05-T11 Section 7) — the exact inverse of `toOrganization`. */
export function toOrganizationRow(organization: Organization): OrganizationRowValues {
  return {
    id: organization.id.value,
    slug: organization.slug.value,
    name: organization.name,
    status: organization.status,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    deletedAt: organization.deletedAt,
  };
}
