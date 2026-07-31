import type { GlobalRepository } from "@corestack/platform";
import type { TransactionContext } from "@corestack/kernel";
import type { PostgresTransactionContext } from "@corestack/platform/postgres";
import type { JSONValue, TransactionSql } from "postgres";

import type { NotificationWorkItem } from "../../application/notification-work-item.js";
import type { NotificationWorkItemRepository } from "../../application/notification-work-item-repository.js";
import {
  toNotificationWorkItem,
  toNotificationWorkItemRow,
  type NotificationWorkItemRow,
} from "./mappers/notification-work-item-mapper.js";

/** Same narrowing `postgres-organization-repository.ts` performs — see that file's doc comment. */
function sqlOf(tx: TransactionContext): TransactionSql {
  return (tx as PostgresTransactionContext).sql;
}

/**
 * The Postgres adapter for `NotificationWorkItemRepository` (E05-T14). A
 * plain `INSERT`, no role elevation of its own — unlike
 * `PostgresOrganizationRepository.existsBySlug`/`findBySlug`, which elevate
 * to `tenancy_platform` and immediately `RESET ROLE` because their
 * surrounding transaction keeps running as `tenancy_app` afterward for
 * other repository calls, this repository's only caller
 * (`invitation-notification-consumer.ts`) owns its transaction outright and
 * elevates once, for the whole transaction, before this method (and the
 * `ProcessedEventStore` check/mark either side of it) ever runs — resetting
 * mid-transaction here would incorrectly drop back to `tenancy_app` before
 * that same transaction's `markProcessed` call, reintroducing the
 * permission error this design avoids. See that file's own doc comment for
 * the elevation.
 *
 * Implements `GlobalRepository` (ADR-0021's marker, ADR-0026's specific
 * justification for this file): there is no per-call `OrgScopedContext` —
 * the caller is a replayed domain event, not an authenticated request —
 * so this repository's write relies on the elevated `tenancy_platform`
 * role's RLS bypass rather than on `app.current_org` scoping. See
 * ADR-0026 for why this differs from `PostgresOrganizationRepository`/
 * `PostgresMembershipRepository`/`PostgresInvitationRepository`, none of
 * which are `GlobalRepository`s.
 */
export class PostgresNotificationWorkItemRepository
  implements NotificationWorkItemRepository, GlobalRepository
{
  readonly __globalRepository = true as const;

  async create(tx: TransactionContext, item: NotificationWorkItem): Promise<void> {
    const sql = sqlOf(tx);
    const row = toNotificationWorkItemRow(item);
    await sql`
      INSERT INTO tenancy.notification_work_items
        (id, type, organization_id, invitation_id, recipient, payload, status, attempts, created_at, processed_at, last_error)
      VALUES (
        ${row.id}::uuid,
        ${row.type},
        ${row.organizationId}::uuid,
        ${row.invitationId}::uuid,
        ${row.recipient},
        ${sql.json(row.payload as JSONValue)},
        ${row.status},
        ${row.attempts},
        ${row.createdAt},
        ${row.processedAt},
        ${row.lastError}
      )
    `;
  }

  /**
   * `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)
   * RETURNING *` — the standard Postgres job-queue claim pattern, and the
   * mechanism behind this port method's promised claim semantics (see the
   * port's own doc comment for what's promised, independent of mechanism):
   *
   * - The inner `SELECT ... FOR UPDATE SKIP LOCKED` locks exactly the one
   *   row it selects. A second, concurrent transaction running the same
   *   statement **skips** any row already locked by the first (that's
   *   what `SKIP LOCKED` means) rather than blocking on it — so two
   *   concurrent claims against two available `PENDING` rows each get a
   *   different row, and two concurrent claims against one available row
   *   result in exactly one success and one `null`, never both succeeding
   *   against the same row.
   * - The outer `UPDATE` — still inside the same statement — transitions
   *   that one locked row to `PROCESSING` and returns it. Read and
   *   transition happen atomically; there is no gap a second caller could
   *   observe.
   * - After this statement's transaction commits, the row's lock is
   *   released, but its `status` is now `PROCESSING` — the `WHERE
   *   status = 'PENDING'` filter is what actually prevents a third caller
   *   from claiming it again later, not the now-released row lock.
   *
   * Ordered `created_at ASC` — oldest pending item claimed first, a
   * simple FIFO policy; nothing in Section 4 asks for priority ordering.
   */
  async claimNextPending(tx: TransactionContext): Promise<NotificationWorkItem | null> {
    const sql = sqlOf(tx);
    const rows = await sql<NotificationWorkItemRow[]>`
      UPDATE tenancy.notification_work_items
      SET status = 'PROCESSING'
      WHERE id = (
        SELECT id FROM tenancy.notification_work_items
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, organization_id, invitation_id, recipient, payload, status, attempts, created_at, processed_at, last_error
    `;
    const row = rows[0];
    return row === undefined ? null : toNotificationWorkItem(row);
  }

  /** `WHERE id = ... AND status = 'PROCESSING'` — makes the claim -> mark handshake self-enforcing at the database: this can only ever affect the one row this same caller just claimed, never a row some other caller has since reclaimed. */
  async markProcessed(tx: TransactionContext, id: string, processedAt: Date): Promise<void> {
    const sql = sqlOf(tx);
    await sql`
      UPDATE tenancy.notification_work_items
      SET status = 'PROCESSED', processed_at = ${processedAt}, last_error = NULL
      WHERE id = ${id}::uuid AND status = 'PROCESSING'
    `;
  }

  /** Same `AND status = 'PROCESSING'` guard as `markProcessed` — see that method's doc comment. */
  async markFailed(
    tx: TransactionContext,
    id: string,
    outcome: { readonly status: "PENDING" | "FAILED"; readonly attempts: number; readonly lastError: string },
  ): Promise<void> {
    const sql = sqlOf(tx);
    await sql`
      UPDATE tenancy.notification_work_items
      SET status = ${outcome.status}, attempts = ${outcome.attempts}, last_error = ${outcome.lastError}
      WHERE id = ${id}::uuid AND status = 'PROCESSING'
    `;
  }
}
