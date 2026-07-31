/**
 * The provider-ready delivery payload (E05-T16 Section 3) — a stable,
 * provider-agnostic JSON shape a future real email adapter (SendGrid, SES,
 * Postmark, SMTP — none built this task) will eventually read and send,
 * without ever touching `NotificationWorkItem` or the tenancy database
 * directly. This is the artifact Section 1 calls "provider-ready": once
 * built, a provider integration is a thin adapter that reads this shape and
 * makes one network call, never a redesign of what gets sent.
 *
 * **Deterministic by construction, not by a serializer.** `id`/`createdAt`
 * are copied verbatim from the source `NotificationWorkItem`, not minted
 * fresh (no `IdGenerator`/`Clock` dependency anywhere in this file) —
 * `buildNotificationDeliveryPayload` is a pure function of its one input,
 * so the same work item always builds the same payload, field for field.
 * That is what makes Section 3's "make the JSON deterministic" and
 * Section 8's "deterministic JSON"/"replay safety" tests meaningful: a
 * payload keyed by a fresh random id on every build could never be
 * replayed or safely re-stored, since two builds of the "same" delivery
 * would be two different rows. `JSON.stringify` over a plain object built
 * with the same field order every call is already deterministic — no
 * canonical/key-sorting serializer is needed on top of a pure builder.
 *
 * **`variables` vs `metadata` — two different audiences, not two names for
 * the same data.** `variables` holds only what a rendered template
 * interpolates into the message body — today, just `invitationId`, since
 * neither `InvitationAcceptedPayload` nor `InvitationExpiredPayload`
 * (E05-T14) carry anything else, and Section 5 forbids reaching into a
 * repository for more (an organization display name, an inviter's name)
 * that isn't already on the work item. `metadata` holds `organizationId`
 * only — operational/audit context a provider might use for tagging or
 * routing, not customer-facing content. Neither includes anything from
 * `NotificationWorkItem` beyond these two ids and the fields already
 * promoted to top-level (`id`, `notificationType`, `recipient`,
 * `createdAt`) — never `status`/`attempts`/`processedAt`/`lastError`,
 * which are queue bookkeeping (Section 5: "do not include internal
 * repository details") with no meaning to a delivery provider.
 *
 * **`recipient: null` is not a defect here — it is a fact a future provider
 * must handle.** `INVITATION_ACCEPTED`/`INVITATION_EXPIRED` work items carry
 * no recipient (E05-T14's own documented choice — resolving one would be a
 * repository read this pure builder cannot perform), so their payloads
 * carry `recipient: null` forward unchanged. This payload's job is to be a
 * faithful, deterministic projection of the work item, not to paper over a
 * gap upstream of it; a future provider adapter reading a `recipient: null`
 * payload must have its own resolution or rejection strategy — see
 * docs/modules/tenancy-delivery-payloads.md's variable contract section.
 */
import type {
  NotificationWorkItem,
  NotificationWorkItemType,
} from "./notification-work-item.js";

/** Section 4's exact mapping. A `Record` keyed by the full union (not `Record<string, string>`) so adding a fourth `NotificationWorkItemType` is a compile error here, not a silent `undefined` lookup at runtime. */
export const NOTIFICATION_TEMPLATE_BY_TYPE: Record<NotificationWorkItemType, string> = {
  INVITATION_CREATED: "invitation-created",
  INVITATION_ACCEPTED: "invitation-accepted",
  INVITATION_EXPIRED: "invitation-expired",
};

/** Section 4: "Subjects may be simple placeholders for now." Plain, human-readable strings — no interpolation, no template engine. */
export const NOTIFICATION_SUBJECT_BY_TYPE: Record<NotificationWorkItemType, string> = {
  INVITATION_CREATED: "You've been invited to join an organization",
  INVITATION_ACCEPTED: "Your invitation was accepted",
  INVITATION_EXPIRED: "Your invitation has expired",
};

/**
 * The stable payload shape (Section 3). Every field is either copied
 * verbatim from the source `NotificationWorkItem` (`id`, `notificationType`,
 * `recipient`, `createdAt`) or derived purely from its `type`/`invitationId`/
 * `organizationId` (`subject`, `template`, `variables`, `metadata`) — no
 * other input, ever.
 */
export interface NotificationDeliveryPayload {
  readonly id: string;
  readonly notificationType: NotificationWorkItemType;
  readonly recipient: string | null;
  readonly subject: string;
  readonly template: string;
  readonly variables: NotificationDeliveryVariables;
  readonly metadata: NotificationDeliveryMetadata;
  readonly createdAt: Date;
}

/** Template-facing values (Section 5). Named properties, not an open `Record<string, string>` — under this project's `noUncheckedIndexedAccess`, an index signature would make every read `string | undefined` for no benefit, since the exact key set is already known and fixed. */
export interface NotificationDeliveryVariables {
  readonly invitationId: string;
}

/** Audit/tracing context (Section 3), distinct from `variables` — see this file's module doc for why the two are not the same slot. */
export interface NotificationDeliveryMetadata {
  readonly organizationId: string;
}

/**
 * Pure. No I/O, no `IdGenerator`, no `Clock` — see this file's module doc
 * for why reusing the work item's own `id`/`createdAt` (rather than minting
 * fresh ones) is what makes this function, and everything built on top of
 * it, deterministic and replay-safe.
 */
export function buildNotificationDeliveryPayload(
  item: NotificationWorkItem,
): NotificationDeliveryPayload {
  return {
    id: item.id,
    notificationType: item.type,
    recipient: item.recipient,
    subject: NOTIFICATION_SUBJECT_BY_TYPE[item.type],
    template: NOTIFICATION_TEMPLATE_BY_TYPE[item.type],
    variables: { invitationId: item.invitationId },
    metadata: { organizationId: item.organizationId },
    createdAt: item.createdAt,
  };
}
