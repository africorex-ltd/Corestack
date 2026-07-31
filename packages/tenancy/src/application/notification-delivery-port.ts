/**
 * The internal delivery port (E05-T15 Section 5). Three methods, one per
 * handled notification type (E05-T14 Section 3) — deliberately no generic
 * `deliver(item)` method, since a single catch-all would force every
 * adapter to re-derive which fields matter per type, exactly the kind of
 * implicit coupling a typed port exists to avoid.
 *
 * **No provider-specific payloads** (Section 13). Each payload carries only
 * the fields already available on `NotificationWorkItem` as first-class,
 * typed columns (`organizationId`/`invitationId`/`recipient`) — never the
 * generic `payload: Record<string, unknown>` JSONB blob, which stays
 * untyped and is not this port's concern. A real provider adapter (a
 * future task) reads whatever else it needs — subject lines, template
 * ids, sender identity — from its own configuration, not from this port's
 * call signature; that keeps this interface stable no matter which
 * provider eventually implements it.
 */
export interface InvitationCreatedDeliveryPayload {
  readonly organizationId: string;
  readonly invitationId: string;
  readonly recipient: string;
}

export interface InvitationAcceptedDeliveryPayload {
  readonly organizationId: string;
  readonly invitationId: string;
}

export interface InvitationExpiredDeliveryPayload {
  readonly organizationId: string;
  readonly invitationId: string;
}

export interface NotificationDeliveryPort {
  deliverInvitationCreated(payload: InvitationCreatedDeliveryPayload): Promise<void>;
  deliverInvitationAccepted(payload: InvitationAcceptedDeliveryPayload): Promise<void>;
  deliverInvitationExpired(payload: InvitationExpiredDeliveryPayload): Promise<void>;
}

/**
 * Thrown for a failure retrying can never fix: an unrecognized work-item
 * `type` (Section 7's "unknown type" — unreachable through the table's own
 * `CHECK` constraint today, but not through a hand-crafted row, a future
 * migration adding a fourth type before this dispatcher is updated, or any
 * caller that bypasses the normal write path), or a work item whose shape
 * can't support the delivery it claims (Section 7's "serialization
 * failure" — concretely, an `INVITATION_CREATED` item with a `null`
 * `recipient`; nothing at the database level prevents that combination,
 * since `recipient` is nullable independently of `type`).
 *
 * The processor (`process-notification-work-item.ts`) treats this
 * distinctly from every other thrown error: it marks the work item
 * `FAILED` immediately, bypassing the attempts-threshold retry logic in
 * `decideNotificationFailureOutcome` entirely — retrying a permanently
 * malformed item would only ever reproduce the same error.
 */
export class NotificationDeliveryPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationDeliveryPermanentError";
  }
}
