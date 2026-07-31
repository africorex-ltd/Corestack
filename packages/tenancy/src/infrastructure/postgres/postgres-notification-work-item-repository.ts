import type { GlobalRepository } from "@corestack/platform";
import type { TransactionContext } from "@corestack/kernel";
import type { PostgresTransactionContext } from "@corestack/platform/postgres";
import type { JSONValue, TransactionSql } from "postgres";

import type { NotificationWorkItem } from "../../application/notification-work-item.js";
import type { NotificationWorkItemRepository } from "../../application/notification-work-item-repository.js";
import { toNotificationWorkItemRow } from "./mappers/notification-work-item-mapper.js";

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
}
