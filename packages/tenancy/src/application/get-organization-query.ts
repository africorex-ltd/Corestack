import type { UnitOfWork } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";

import type { Organization } from "../domain/organization.js";
import type { OrganizationStatus } from "../domain/organization-status.js";
import type { OrganizationRepository } from "./organization-repository.js";

/** A DTO, not the aggregate (Section 3: "return DTOs, not aggregates") — callers of this query never see `Organization` directly. Deliberately excludes `deletedAt`, unlike `Organization` itself: the founder directive's Section 4 field list stops at `updatedAt`. */
export interface OrganizationSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Explicit aggregate-to-DTO mapper (Section 7: "create explicit row-to-DTO mappers") — not a `findById` return value reused as-is. */
export function toOrganizationSummary(organization: Organization): OrganizationSummary {
  return {
    id: organization.id.value,
    slug: organization.slug.value,
    name: organization.name,
    status: organization.status,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

export interface GetOrganizationDeps {
  /** The generic kernel port, not `PostgresUnitOfWork` — no infrastructure coupling, same as every existing use case's `deps.uow`. */
  readonly uow: UnitOfWork;
  readonly repository: OrganizationRepository;
}

/**
 * `GetOrganizationQuery` (E05-T12) — the read-side counterpart to
 * `OrganizationRepository.findById`. Deliberately mirrors that method's
 * exact parameter shape (`context: OrgScopedContext` **and** a separate
 * `organizationId`, rather than always reading `context.organizationId`):
 * the explicit `organizationId` is "what the caller is asking for" (e.g.
 * a path parameter in a future HTTP handler), which is not necessarily
 * trustworthy input — RLS, not this function, is what actually decides
 * whether the row comes back (Section 3: "rely on RLS"). A mismatched
 * `organizationId` (asking about a different organization than the one
 * `context`/the enclosing transaction is scoped to) returns `null`, the
 * same as a genuinely missing row — this query performs no authorization
 * of its own beyond that (Section 3).
 *
 * No new repository method was added for this (Section 2) —
 * `findById` already exists, unchanged since E05-T02/T11.
 */
export async function getOrganization(
  context: OrgScopedContext,
  organizationId: string,
  deps: GetOrganizationDeps,
): Promise<OrganizationSummary | null> {
  return deps.uow.run(async (tx) => {
    const organization = await deps.repository.findById(tx, context, organizationId);
    return organization === null ? null : toOrganizationSummary(organization);
  });
}
