import type {
  NotificationWorkItem,
  NotificationWorkItemStatus,
  NotificationWorkItemType,
} from "../../../application/notification-work-item.js";

/**
 * Raw `tenancy.notification_work_items` row shape. Unlike
 * `organization-mapper.ts`/`invitation-mapper.ts`, there is no domain
 * aggregate on the other end of this mapping — `NotificationWorkItem`
 * (application layer) already is the plain shape; this mapper only
 * translates column naming (`snake_case` <-> `camelCase`) and `jsonb`
 * <-> object, the same translation every other mapper in this directory
 * does, just without a `reconstitute()`/aggregate step in between.
 */
export interface NotificationWorkItemRow {
  readonly id: string;
  readonly type: string;
  readonly organization_id: string;
  readonly invitation_id: string;
  readonly recipient: string | null;
  readonly payload: Record<string, unknown>;
  readonly status: string;
  readonly attempts: number;
  readonly created_at: Date;
  readonly processed_at: Date | null;
  readonly last_error: string | null;
}

/** Row -> model. `type`/`status` are trusted as their respective enums — the table's `CHECK` constraints (this task's migration) already guarantee legal values, the same trust every other mapper in this directory extends to its own enum columns. */
export function toNotificationWorkItem(row: NotificationWorkItemRow): NotificationWorkItem {
  return {
    id: row.id,
    type: row.type as NotificationWorkItemType,
    organizationId: row.organization_id,
    invitationId: row.invitation_id,
    recipient: row.recipient,
    payload: row.payload,
    status: row.status as NotificationWorkItemStatus,
    attempts: row.attempts,
    createdAt: row.created_at,
    processedAt: row.processed_at,
    lastError: row.last_error,
  };
}

/** Model -> row values, for the one `INSERT` this task ever performs. */
export interface NotificationWorkItemRowValues {
  readonly id: string;
  readonly type: NotificationWorkItemType;
  readonly organizationId: string;
  readonly invitationId: string;
  readonly recipient: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: NotificationWorkItemStatus;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly processedAt: Date | null;
  readonly lastError: string | null;
}

export function toNotificationWorkItemRow(item: NotificationWorkItem): NotificationWorkItemRowValues {
  return {
    id: item.id,
    type: item.type,
    organizationId: item.organizationId,
    invitationId: item.invitationId,
    recipient: item.recipient,
    payload: item.payload,
    status: item.status,
    attempts: item.attempts,
    createdAt: item.createdAt,
    processedAt: item.processedAt,
    lastError: item.lastError,
  };
}
