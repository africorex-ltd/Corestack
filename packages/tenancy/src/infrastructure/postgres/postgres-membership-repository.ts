import type { TransactionContext } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";
import type { PostgresTransactionContext } from "@corestack/platform/postgres";
import type { TransactionSql } from "postgres";

import type { Membership } from "../../domain/membership.js";
import { MembershipStatus } from "../../domain/membership-status.js";
import type { MembershipRepository } from "../../application/membership-repository.js";
import { MembershipAlreadyExistsError } from "../../application/membership-already-exists-error.js";
import { toMembership, toMembershipRow, type MembershipRow } from "./mappers/membership-mapper.js";
import { uniqueViolationConstraintName } from "./constraint-violation.js";

function sqlOf(tx: TransactionContext): TransactionSql {
  return (tx as PostgresTransactionContext).sql;
}

/**
 * The Postgres adapter for `MembershipRepository` (E05-T11). Every query
 * here relies entirely on RLS for organization scoping — no method adds
 * its own `WHERE organization_id = ...` clause (Section 11/12's permanent
 * policy: "repository code must not duplicate policy logic"; "RLS is the
 * isolation boundary"). `app.current_org` is already set for the whole
 * transaction by the enclosing `PostgresUnitOfWork`, constructed with
 * `context.organizationId` — no platform-role elevation needed anywhere
 * in this class, unlike `PostgresOrganizationRepository`. See
 * `docs/modules/tenancy-postgres-adapters.md` for the full design.
 */
export class PostgresMembershipRepository implements MembershipRepository {
  async findById(
    tx: TransactionContext,
    _context: OrgScopedContext,
    membershipId: string,
  ): Promise<Membership | null> {
    const sql = sqlOf(tx);
    const rows = await sql<MembershipRow[]>`
      SELECT id, organization_id, user_id, role, status, joined_at, updated_at, removed_at
      FROM tenancy.memberships
      WHERE id = ${membershipId}::uuid
    `;
    const row = rows[0];
    return row === undefined ? null : toMembership(row);
  }

  async listForOrganization(
    tx: TransactionContext,
    _context: OrgScopedContext,
  ): Promise<readonly Membership[]> {
    const sql = sqlOf(tx);
    const rows = await sql<MembershipRow[]>`
      SELECT id, organization_id, user_id, role, status, joined_at, updated_at, removed_at
      FROM tenancy.memberships
      ORDER BY joined_at
    `;
    return rows.map(toMembership);
  }

  /**
   * "This user's current membership" (the port's own doc comment) — when
   * more than one row exists for the same user (the schema permits it;
   * only `ACTIVE` uniqueness is enforced, see `memberships_active_org_
   * user_key`), the most recently updated row is treated as current.
   * Matches the in-memory reference's own "last `save` wins" simplification
   * for the single-row case, and gives a deterministic answer for the
   * multi-row case the in-memory adapter cannot even represent.
   */
  async findByUserId(
    tx: TransactionContext,
    _context: OrgScopedContext,
    userId: string,
  ): Promise<Membership | null> {
    const sql = sqlOf(tx);
    const rows = await sql<MembershipRow[]>`
      SELECT id, organization_id, user_id, role, status, joined_at, updated_at, removed_at
      FROM tenancy.memberships
      WHERE user_id = ${userId}::uuid
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    return row === undefined ? null : toMembership(row);
  }

  /** Matches `memberships_active_org_user_key`'s own shape exactly (org + user + `status = 'ACTIVE'`) rather than delegating to `findByUserId` — a direct, indexed existence check, not a fetch-then-inspect. */
  async existsActive(
    tx: TransactionContext,
    _context: OrgScopedContext,
    userId: string,
  ): Promise<boolean> {
    const sql = sqlOf(tx);
    const rows = await sql`
      SELECT 1 FROM tenancy.memberships
      WHERE user_id = ${userId}::uuid AND status = ${MembershipStatus.Active}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  async save(
    tx: TransactionContext,
    _context: OrgScopedContext,
    membership: Membership,
  ): Promise<void> {
    const sql = sqlOf(tx);
    const values = toMembershipRow(membership);

    try {
      await sql`
        INSERT INTO tenancy.memberships (id, organization_id, user_id, role, status, joined_at, updated_at, removed_at)
        VALUES (
          ${values.id}::uuid,
          ${values.organizationId}::uuid,
          ${values.userId}::uuid,
          ${values.role},
          ${values.status},
          ${values.joinedAt},
          ${values.updatedAt},
          ${values.removedAt}
        )
        ON CONFLICT (id) DO UPDATE SET
          role = EXCLUDED.role,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at,
          removed_at = EXCLUDED.removed_at
      `;
    } catch (error) {
      if (uniqueViolationConstraintName(error) === "memberships_active_org_user_key") {
        throw new MembershipAlreadyExistsError(values.userId, values.organizationId);
      }
      throw error;
    }
  }
}
