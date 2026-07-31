import type {
  NotificationDeliveryMetadata,
  NotificationDeliveryPayload,
  NotificationDeliveryVariables,
} from "../../../application/notification-delivery-payload.js";
import type { NotificationWorkItemType } from "../../../application/notification-work-item.js";

/**
 * Raw `tenancy.notification_delivery_payloads` row shape. `payload` is the
 * full `NotificationDeliveryPayload`, jsonb-encoded — the single source of
 * truth `toNotificationDeliveryPayload` reads from. `organization_id`/
 * `notification_type`/`recipient`/`created_at` are real, indexed/RLS-scoped
 * columns *derived from* that same JSON at write time (see
 * `toNotificationDeliveryPayloadRow`), not an independent second copy that
 * could drift from it — every row is written from one in-memory
 * `NotificationDeliveryPayload`, never assembled from separately-sourced
 * column values.
 */
export interface NotificationDeliveryPayloadRow {
  readonly id: string;
  readonly organization_id: string;
  readonly notification_type: string;
  readonly recipient: string | null;
  readonly payload: NotificationDeliveryPayloadJson;
  readonly created_at: Date;
}

/**
 * The jsonb-encoded shape of `NotificationDeliveryPayload`. Identical to
 * the domain shape except `createdAt`, which is a plain ISO string inside
 * JSON — `jsonb` has no native date type, so the domain `Date` is
 * serialized on the way in and parsed back on the way out (the real
 * `created_at` timestamptz column stores the same instant natively, and is
 * what every other tenancy table's own timestamp columns already do).
 */
export interface NotificationDeliveryPayloadJson {
  readonly id: string;
  readonly notificationType: string;
  readonly recipient: string | null;
  readonly subject: string;
  readonly template: string;
  readonly variables: NotificationDeliveryVariables;
  readonly metadata: NotificationDeliveryMetadata;
  readonly createdAt: string;
}

/** Row -> model. `notificationType` is trusted as `NotificationWorkItemType` — the same CHECK-constraint trust every other mapper in this directory extends to its own enum columns. */
export function toNotificationDeliveryPayload(
  row: NotificationDeliveryPayloadRow,
): NotificationDeliveryPayload {
  const json = row.payload;
  return {
    id: json.id,
    notificationType: json.notificationType as NotificationWorkItemType,
    recipient: json.recipient,
    subject: json.subject,
    template: json.template,
    variables: json.variables,
    metadata: json.metadata,
    createdAt: new Date(json.createdAt),
  };
}

/** Model -> row values, for `store`'s `INSERT ... ON CONFLICT (id) DO NOTHING`. `organizationId` comes from `payload.metadata.organizationId` — the only place this mapper's input carries it, since `NotificationDeliveryPayload` has no top-level `organizationId` field (Section 3 doesn't list one). */
export interface NotificationDeliveryPayloadRowValues {
  readonly id: string;
  readonly organizationId: string;
  readonly notificationType: NotificationWorkItemType;
  readonly recipient: string | null;
  readonly payload: NotificationDeliveryPayloadJson;
  readonly createdAt: Date;
}

export function toNotificationDeliveryPayloadRow(
  payload: NotificationDeliveryPayload,
): NotificationDeliveryPayloadRowValues {
  return {
    id: payload.id,
    organizationId: payload.metadata.organizationId,
    notificationType: payload.notificationType,
    recipient: payload.recipient,
    payload: {
      id: payload.id,
      notificationType: payload.notificationType,
      recipient: payload.recipient,
      subject: payload.subject,
      template: payload.template,
      variables: payload.variables,
      metadata: payload.metadata,
      createdAt: payload.createdAt.toISOString(),
    },
    createdAt: payload.createdAt,
  };
}
