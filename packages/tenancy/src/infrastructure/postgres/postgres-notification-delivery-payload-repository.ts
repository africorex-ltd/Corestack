import type { GlobalRepository } from "@corestack/platform";
import type { TransactionContext } from "@corestack/kernel";
import type { PostgresTransactionContext } from "@corestack/platform/postgres";
import type { JSONValue, TransactionSql } from "postgres";

import type { NotificationDeliveryPayload } from "../../application/notification-delivery-payload.js";
import type { NotificationDeliveryPayloadRepository } from "../../application/notification-delivery-payload-repository.js";
import {
  toNotificationDeliveryPayload,
  toNotificationDeliveryPayloadRow,
  type NotificationDeliveryPayloadRow,
} from "./mappers/notification-delivery-payload-mapper.js";

/** Same narrowing `postgres-organization-repository.ts` performs — see that file's doc comment. */
function sqlOf(tx: TransactionContext): TransactionSql {
  return (tx as PostgresTransactionContext).sql;
}

/**
 * The Postgres adapter for `NotificationDeliveryPayloadRepository`
 * (E05-T16). Implements `GlobalRepository` and cites **ADR-0026** — the
 * exact reasoning that ADR establishes for `PostgresNotificationWorkItemRepository`
 * (called from an event consumer, no authenticated caller, no
 * `app.current_org` to set, visibility via the elevated `tenancy_platform`
 * role instead) applies unchanged here: this repository's only caller
 * (`infrastructure/postgres/notification-payload-delivery-adapter.ts`) is
 * likewise a background adapter operating on a bare `NotificationWorkItem`,
 * not a per-request `OrgScopedContext`.
 */
export class PostgresNotificationDeliveryPayloadRepository
  implements NotificationDeliveryPayloadRepository, GlobalRepository
{
  readonly __globalRepository = true as const;

  /**
   * `INSERT ... ON CONFLICT (id) DO NOTHING` — idempotent by construction,
   * not merely "safe to call twice by luck". Because
   * `buildNotificationDeliveryPayload` is a pure function of the source
   * work item, two calls for the same item always produce byte-identical
   * `payload` values under the same `id`; `DO NOTHING` makes the second
   * call a true no-op rather than a constraint-violation error or a
   * (harmless but wasteful) overwrite. This is the mechanism behind
   * Section 8's "replay safety": re-running the delivery adapter for a
   * work item it already processed leaves exactly one row behind.
   */
  async store(tx: TransactionContext, payload: NotificationDeliveryPayload): Promise<void> {
    const sql = sqlOf(tx);
    const row = toNotificationDeliveryPayloadRow(payload);
    await sql`
      INSERT INTO tenancy.notification_delivery_payloads
        (id, organization_id, notification_type, recipient, payload, created_at)
      VALUES (
        ${row.id}::uuid,
        ${row.organizationId}::uuid,
        ${row.notificationType},
        ${row.recipient},
        ${sql.json(row.payload as unknown as JSONValue)},
        ${row.createdAt}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async findById(tx: TransactionContext, id: string): Promise<NotificationDeliveryPayload | null> {
    const sql = sqlOf(tx);
    const rows = await sql<NotificationDeliveryPayloadRow[]>`
      SELECT id, organization_id, notification_type, recipient, payload, created_at
      FROM tenancy.notification_delivery_payloads
      WHERE id = ${id}::uuid
    `;
    const row = rows[0];
    return row === undefined ? null : toNotificationDeliveryPayload(row);
  }
}
