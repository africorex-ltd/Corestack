import type { TransactionContext } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";
import type { PostgresTransactionContext } from "@corestack/platform/postgres";
import type { TransactionSql } from "postgres";

import type { Invitation } from "../../domain/invitation.js";
import { InvitationStatus } from "../../domain/invitation-status.js";
import type { Email } from "../../domain/email.js";
import type { InvitationRepository } from "../../application/invitation-repository.js";
import { InvitationAlreadyExistsError } from "../../application/invitation-already-exists-error.js";
import { toInvitation, toInvitationRow, type InvitationRow } from "./mappers/invitation-mapper.js";
import { uniqueViolationConstraintName } from "./constraint-violation.js";

function sqlOf(tx: TransactionContext): TransactionSql {
  return (tx as PostgresTransactionContext).sql;
}

/**
 * The Postgres adapter for `InvitationRepository` (E05-T11). Same
 * no-explicit-organization-filter discipline as
 * `PostgresMembershipRepository` — every query relies entirely on RLS
 * for organization scoping, no platform-role elevation anywhere in this
 * class. See `docs/modules/tenancy-postgres-adapters.md` for the full
 * design.
 */
export class PostgresInvitationRepository implements InvitationRepository {
  async findById(
    tx: TransactionContext,
    _context: OrgScopedContext,
    invitationId: string,
  ): Promise<Invitation | null> {
    const sql = sqlOf(tx);
    const rows = await sql<InvitationRow[]>`
      SELECT id, organization_id, email, role, status, invited_by, created_at, expires_at, responded_at
      FROM tenancy.invitations
      WHERE id = ${invitationId}::uuid
    `;
    const row = rows[0];
    return row === undefined ? null : toInvitation(row);
  }

  async listForOrganization(
    tx: TransactionContext,
    _context: OrgScopedContext,
  ): Promise<readonly Invitation[]> {
    const sql = sqlOf(tx);
    const rows = await sql<InvitationRow[]>`
      SELECT id, organization_id, email, role, status, invited_by, created_at, expires_at, responded_at
      FROM tenancy.invitations
      ORDER BY created_at
    `;
    return rows.map(toInvitation);
  }

  /** Matches `invitations_pending_org_email_key`'s own shape exactly (org + email + `status = 'PENDING'`) — a direct, indexed existence check. */
  async existsPendingForEmail(
    tx: TransactionContext,
    _context: OrgScopedContext,
    email: Email,
  ): Promise<boolean> {
    const sql = sqlOf(tx);
    const rows = await sql`
      SELECT 1 FROM tenancy.invitations
      WHERE email = ${email.value} AND status = ${InvitationStatus.Pending}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  async save(
    tx: TransactionContext,
    _context: OrgScopedContext,
    invitation: Invitation,
  ): Promise<void> {
    const sql = sqlOf(tx);
    const values = toInvitationRow(invitation);

    try {
      await sql`
        INSERT INTO tenancy.invitations (id, organization_id, email, role, status, invited_by, created_at, expires_at, responded_at)
        VALUES (
          ${values.id}::uuid,
          ${values.organizationId}::uuid,
          ${values.email},
          ${values.role},
          ${values.status},
          ${values.invitedBy}::uuid,
          ${values.createdAt},
          ${values.expiresAt},
          ${values.respondedAt}
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          responded_at = EXCLUDED.responded_at
      `;
    } catch (error) {
      if (uniqueViolationConstraintName(error) === "invitations_pending_org_email_key") {
        throw new InvitationAlreadyExistsError(values.email, values.organizationId);
      }
      throw error;
    }
  }
}
