import type { Context, TransactionContext } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";

import type { Organization } from "../domain/organization.js";
import type { OrganizationSlug } from "../domain/organization-slug.js";

/**
 * Port only until E05-T11; now backed by `PostgresOrganizationRepository`
 * (`infrastructure/postgres/postgres-organization-repository.ts`) as well
 * as the in-memory reference (`test-support/in-memory-organization-
 * repository.ts`). See `docs/modules/tenancy-postgres-adapters.md` for
 * the adapter's transaction/RLS/mapper strategy, and
 * `docs/modules/tenancy-rls-design.md`/[ADR-0024](../../../docs/adr/0024-tenancy-organizations-rls-direct-visibility.md)
 * for why `organizations`' RLS policy is keyed directly off `id`, not
 * `organization_id`.
 *
 * Returns the real `Organization` aggregate (E05-T02), not a bare record —
 * a repository reconstitutes the aggregate from persisted rows (via
 * `Organization.reconstitute`, E05-T11), it doesn't hand back an anemic
 * DTO.
 *
 * **Every method takes `tx: TransactionContext` as its first parameter**
 * (E05-T11) — the generic kernel type (`{ publish }`), not a
 * Postgres-specific one, so this port stays infrastructure-agnostic.
 * Every call site is inside a `UnitOfWork.run()` callback, which is the
 * transaction boundary (`docs/unit-of-work.md`'s "Transaction ownership"
 * rule: "inside a `UnitOfWork.run()` callback, use `ctx.sql` for
 * repository queries... do not open a second transaction here").
 * `PostgresOrganizationRepository` narrows `tx` to
 * `PostgresTransactionContext` internally to reach `.sql`; the in-memory
 * implementation ignores it entirely. This mirrors
 * `examples/acme-crm-module`'s `ContactRepository.create(tx: TransactionSql, ...)`
 * precedent, adapted to stay adapter-agnostic at the port level.
 *
 * `existsBySlug`/`findBySlug`/`save` (E05-T03/T11) deliberately take a
 * plain `Context`, not `OrgScopedContext`, unlike their siblings above:
 * creating an organization is necessarily a pre-org-scope operation —
 * there is no organization to scope by yet, since this is the operation
 * that creates one. See `existsBySlug`'s own doc comment for the RLS
 * consequence of this.
 */
export interface OrganizationRepository {
  findById(
    tx: TransactionContext,
    context: OrgScopedContext,
    organizationId: string,
  ): Promise<Organization | null>;
  listForContext(tx: TransactionContext, context: OrgScopedContext): Promise<readonly Organization[]>;

  /**
   * Whether an organization with this slug already exists, checked
   * cross-tenant (any organization, not just the caller's current one).
   *
   * **RLS consequence (E05-T11, first encountered here):** `organizations`'
   * app-role policy restricts visibility to `id =
   * current_setting('app.current_org')::uuid` (ADR-0024) — structurally
   * blind to every *other* organization's row, which is exactly the slugs
   * this check needs to see. `PostgresOrganizationRepository` resolves
   * this the same way ADR-0024 already resolves "list organizations the
   * user belongs to": a deliberate, narrow, explicit elevation to the
   * platform role (`SET LOCAL ROLE`, reverted immediately after this one
   * read) for this single query — not a new bypass mechanism, the same
   * `platform_full_access` policy every other cross-tenant read already
   * uses. **Still not a hard uniqueness guarantee** — a race between two
   * concurrent callers can both pass this check; `organizations_slug_key`
   * (the real unique constraint) plus `save`'s constraint-violation
   * translation into `DuplicateSlugError` is the actual enforcement. See
   * `docs/modules/tenancy-postgres-adapters.md`'s "RLS assumptions".
   */
  existsBySlug(tx: TransactionContext, context: Context, slug: OrganizationSlug): Promise<boolean>;

  /**
   * Finds an organization by slug, cross-tenant — added in E05-T11 per
   * the founder directive's explicit Section 4 ask. **No current caller**
   * (`createOrganization` uses `existsBySlug`, not this) — added because
   * the directive names it explicitly as a required method, not because
   * a call site was discovered; flagged here so a future reader doesn't
   * mistake it for a load-bearing dependency. Same RLS elevation as
   * `existsBySlug` (see that method's doc comment) and the same
   * "structurally cross-tenant, not a nice-to-have" reasoning.
   */
  findBySlug(tx: TransactionContext, context: Context, slug: OrganizationSlug): Promise<Organization | null>;

  /**
   * Persists a newly created (or subsequently modified) organization.
   * **The Postgres adapter sets `app.current_org` from the aggregate's
   * own `organization.id` as its first statement, inside this same
   * transaction** — not via `PostgresUnitOfWork`'s constructor, which
   * cannot know the id at construction time for a brand-new organization.
   * See [ADR-0025](../../../docs/adr/0025-organization-save-sets-own-org-context.md),
   * which supersedes that specific claim in ADR-0024.
   */
  save(tx: TransactionContext, context: Context, organization: Organization): Promise<void>;
}
