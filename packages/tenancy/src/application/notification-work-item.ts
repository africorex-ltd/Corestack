/**
 * The durable notification work-item model (E05-T14 Section 4) — the
 * record an invitation-notification event handler creates so that a
 * future, not-yet-built delivery worker has something durable to read and
 * act on. This is bookkeeping, not a domain aggregate: no invariants
 * beyond "these fields exist," no domain events of its own, no aggregate
 * methods — a plain data shape a repository persists and later (a future
 * task) transitions.
 */

/**
 * One entry per handled event name (Section 3): `INVITATION_CREATED`,
 * `INVITATION_ACCEPTED`, `INVITATION_EXPIRED`. `MEMBER_JOINED` is
 * deliberately not a member of this union — Section 3: "Ignore
 * MEMBER_JOINED for now."
 */
export type NotificationWorkItemType =
  | "INVITATION_CREATED"
  | "INVITATION_ACCEPTED"
  | "INVITATION_EXPIRED";

/**
 * Section 7: "Implement only state tracking... Do not implement a
 * scheduler." All four values exist so the column's `CHECK` constraint is
 * complete from day one, even though this task's own handlers only ever
 * produce `PENDING` — `PROCESSING`/`PROCESSED`/`FAILED` are transitions a
 * future delivery worker makes, not built here (Section 12: "delivery can
 * be added later without changing workflows").
 */
export type NotificationWorkItemStatus = "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED";

/**
 * `recipient` is nullable, not an empty-string sentinel. `INVITATION_CREATED`
 * always has one (`InvitationCreatedPayload.email`). `INVITATION_ACCEPTED`/
 * `INVITATION_EXPIRED` do not — `InvitationAcceptedPayload`/
 * `InvitationExpiredPayload` (E05-T07) carry only `invitationId`/
 * `organizationId`, no email, and Section 5 forbids this handler from
 * performing the I/O (a repository read) that resolving one would require.
 * Enriching those two payloads with an email field is a domain-event-shape
 * change beyond this task's scope; a future delivery adapter resolving the
 * recipient via its own read at send time is the documented alternative —
 * see docs/modules/tenancy-notification-orchestration.md's "Why recipient
 * is nullable" section. An empty string here would be the exact `?? ""`
 * masking mistake corrected in E05-T13's HTTP layer, reproduced.
 */
export interface NotificationWorkItem {
  readonly id: string;
  readonly type: NotificationWorkItemType;
  readonly organizationId: string;
  readonly invitationId: string;
  readonly recipient: string | null;
  /** The source domain event's own payload, verbatim — a future delivery adapter's template input. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: NotificationWorkItemStatus;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly processedAt: Date | null;
  readonly lastError: string | null;
}
