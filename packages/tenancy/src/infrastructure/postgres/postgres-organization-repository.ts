import type { Context, TransactionContext } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";
import type { PostgresTransactionContext } from "@corestack/platform/postgres";
import type { TransactionSql } from "postgres";

import type { Organization } from "../../domain/organization.js";
import type { OrganizationSlug } from "../../domain/organization-slug.js";
import type { OrganizationRepository } from "../../application/organization-repository.js";
import { DuplicateSlugError } from "../../application/duplicate-slug-error.js";
import { toOrganization, toOrganizationRow, type OrganizationRow } from "./mappers/organization-mapper.js";
import { uniqueViolationConstraintName } from "./constraint-violation.js";
import { TENANCY_PLATFORM_ROLE } from "./rls/roles.js";

/**
 * `tx` is the generic kernel `TransactionContext` at the port level
 * (`organization-repository.ts`'s own doc comment explains why); every
 * real call site is inside a `PostgresUnitOfWork.run()` callback, whose
 * runtime object always additionally carries `.sql` even though the
 * static port type doesn't say so. This narrowing is the one place that
 * knowledge is used — contained here, not leaked back into the port.
 */
function sqlOf(tx: TransactionContext): TransactionSql {
  return (tx as PostgresTransactionContext).sql;
}

/**
 * The Postgres adapter for `OrganizationRepository` (E05-T11). See
 * `docs/modules/tenancy-postgres-adapters.md` for the full design:
 * transaction boundaries, the `existsBySlug`/`findBySlug` platform-role
 * elevation, `save`'s self-scoping `set_config` call
 * ([ADR-0025](../../../../../docs/adr/0025-organization-save-sets-own-org-context.md)),
 * and constraint-violation translation.
 */
export class PostgresOrganizationRepository implements OrganizationRepository {
  async findById(
    tx: TransactionContext,
    _context: OrgScopedContext,
    organizationId: string,
  ): Promise<Organization | null> {
    const sql = sqlOf(tx);
    const rows = await sql<OrganizationRow[]>`
      SELECT id, slug, name, status, created_at, updated_at, deleted_at
      FROM tenancy.organizations
      WHERE id = ${organizationId}::uuid
    `;
    const row = rows[0];
    return row === undefined ? null : toOrganization(row);
  }

  async listForContext(
    tx: TransactionContext,
    context: OrgScopedContext,
  ): Promise<readonly Organization[]> {
    const organization = await this.findById(tx, context, context.organizationId);
    return organization === null ? [] : [organization];
  }

  /**
   * See `organization-repository.ts`'s doc comment on this method for the
   * ADR-0024 RLS consequence this exists to work around: the app role's
   * `organizations_select` policy can only ever see the one organization
   * matching the current transaction's `app.current_org`, which
   * structurally cannot include "every other organization's slug." This
   * elevates to `tenancy_platform` (`USING (true)`, no `app.current_org`
   * dependency) for this one query, then reverts immediately — never
   * leaving the transaction's effective role changed for whatever runs
   * after it (`save`'s own `INSERT`/`UPDATE` still needs the `tenancy_app`
   * grants).
   */
  async existsBySlug(
    tx: TransactionContext,
    _context: Context,
    slug: OrganizationSlug,
  ): Promise<boolean> {
    const sql = sqlOf(tx);
    await sql.unsafe(`SET LOCAL ROLE ${TENANCY_PLATFORM_ROLE}`);
    try {
      const rows = await sql`
        SELECT 1 FROM tenancy.organizations WHERE slug = ${slug.value} LIMIT 1
      `;
      return rows.length > 0;
    } finally {
      await sql.unsafe(`RESET ROLE`);
    }
  }

  /** Added per the founder directive's explicit Section 4 ask — no current caller; see `organization-repository.ts`'s doc comment. Same platform-role elevation as `existsBySlug`, for the same structural reason. */
  async findBySlug(
    tx: TransactionContext,
    _context: Context,
    slug: OrganizationSlug,
  ): Promise<Organization | null> {
    const sql = sqlOf(tx);
    await sql.unsafe(`SET LOCAL ROLE ${TENANCY_PLATFORM_ROLE}`);
    try {
      const rows = await sql<OrganizationRow[]>`
        SELECT id, slug, name, status, created_at, updated_at, deleted_at
        FROM tenancy.organizations
        WHERE slug = ${slug.value}
      `;
      const row = rows[0];
      return row === undefined ? null : toOrganization(row);
    } finally {
      await sql.unsafe(`RESET ROLE`);
    }
  }

  /**
   * Sets `app.current_org` from the aggregate's own `organization.id`
   * before the `INSERT`/`UPDATE` — see
   * [ADR-0025](../../../../../docs/adr/0025-organization-save-sets-own-org-context.md)
   * for why this happens here rather than at `PostgresUnitOfWork`
   * construction. `ON CONFLICT (id) DO UPDATE` is this method's single
   * mechanism for both creation and later updates — `created_at` is
   * deliberately absent from the `SET` list so an update never overwrites
   * the original creation instant.
   */
  async save(tx: TransactionContext, _context: Context, organization: Organization): Promise<void> {
    const sql = sqlOf(tx);
    const values = toOrganizationRow(organization);

    await sql`SELECT set_config('app.current_org', ${values.id}, true)`;

    try {
      await sql`
        INSERT INTO tenancy.organizations (id, slug, name, status, created_at, updated_at, deleted_at)
        VALUES (
          ${values.id}::uuid,
          ${values.slug},
          ${values.name},
          ${values.status},
          ${values.createdAt},
          ${values.updatedAt},
          ${values.deletedAt}
        )
        ON CONFLICT (id) DO UPDATE SET
          slug = EXCLUDED.slug,
          name = EXCLUDED.name,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at
      `;
    } catch (error) {
      if (uniqueViolationConstraintName(error) === "organizations_slug_key") {
        throw new DuplicateSlugError(values.slug);
      }
      throw error;
    }
  }
}
