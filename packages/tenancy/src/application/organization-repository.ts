import type { Context } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";

import type { Organization } from "../domain/organization.js";
import type { OrganizationSlug } from "../domain/organization-slug.js";

/**
 * Port only — no persistence implementation yet (E05-T09 froze the
 * database shape; a later task builds the Postgres adapter). See
 * `docs/modules/tenancy-schema-design.md`'s "Repository persistence
 * expectations" section for the transactional/uniqueness/concurrency
 * contract this port's eventual adapter must satisfy, and its "RLS
 * attachment points" section for the still-open `organizations` RLS
 * question referenced just below.
 *
 * Method signatures are provisional: `docs/modules/tenancy-
 * contract.md`'s own "RLS requirements" section flags `organizations` as
 * an open question — is it a normal org-scoped table, or does its RLS
 * policy need a membership-join condition instead, since a row *is* an
 * organization rather than something scoped *to* one? That decision
 * belongs to a future RLS task, not this scaffold. `OrgScopedContext` is used here
 * to satisfy the org-scoping discipline structurally (a caller must have
 * resolved *some* organization context to call this port) without
 * pre-deciding how `organizations` itself will be scoped at the database
 * layer.
 *
 * Returns the real `Organization` aggregate (E05-T02), not a bare record —
 * a repository reconstitutes the aggregate from persisted rows, it doesn't
 * hand back an anemic DTO.
 *
 * `existsBySlug`/`save` (E05-T03) deliberately take a plain `Context`, not
 * `OrgScopedContext`, unlike their siblings above: creating an
 * organization is necessarily a pre-org-scope operation — there is no
 * organization to scope by yet, since this is the operation that creates
 * one. Neither method takes a `sql`/transaction handle (contrast
 * `examples/acme-crm-module`'s `ContactRepository.create(tx: TransactionSql, ...)`)
 * — that would require depending on `@corestack/platform/postgres` before
 * any Postgres adapter exists for this module, which is exactly the
 * infrastructure coupling E05-T03 exists to avoid. How a future
 * `PostgresOrganizationRepository` binds itself to the enclosing
 * transaction is E05-T21's problem to solve, not this port's.
 */
export interface OrganizationRepository {
  findById(context: OrgScopedContext, organizationId: string): Promise<Organization | null>;
  listForContext(context: OrgScopedContext): Promise<readonly Organization[]>;

  /** Whether an organization with this slug already exists. */
  existsBySlug(context: Context, slug: OrganizationSlug): Promise<boolean>;

  /** Persists a newly created (or subsequently modified) organization. */
  save(context: Context, organization: Organization): Promise<void>;
}
