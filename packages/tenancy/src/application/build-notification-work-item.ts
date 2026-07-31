/**
 * The pure event -> work-item translation (E05-T14 Section 5: "do not
 * perform I/O"). Given a domain event and nothing else, deterministically
 * produces the work item to persist, or `null` to ignore the event
 * entirely (`MEMBER_JOINED_EVENT`, Section 3, and anything this module
 * doesn't otherwise recognize). No repository, no database, no clock/id
 * side effects beyond the two explicitly injected generators — fully
 * unit-testable with no Postgres involved.
 *
 * "No I/O" here means no *delivery* I/O (Section 1's goal, Section 13's
 * restrictions) and no I/O beyond what's needed to shape this one record —
 * not "never touches a database anywhere in this task." The registered
 * `EventSubscription` handler (`infrastructure/postgres/
 * invitation-notification-consumer.ts`) is the piece that actually
 * persists what this function returns; `registerPurgeHandler`
 * (`@corestack/platform`) already establishes this precedent for the
 * *purge* event handler, which performs real deletes inside its own
 * handler. See docs/modules/tenancy-notification-orchestration.md for the
 * full reasoning.
 */
import type { Clock, DomainEvent, IdGenerator } from "@corestack/kernel";

import {
  INVITATION_ACCEPTED_EVENT,
  INVITATION_CREATED_EVENT,
  INVITATION_EXPIRED_EVENT,
  type InvitationAcceptedPayload,
  type InvitationCreatedPayload,
  type InvitationExpiredPayload,
} from "./events.js";
import type { NotificationWorkItem } from "./notification-work-item.js";

export interface BuildNotificationWorkItemDeps {
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/**
 * Events whose payload is JSON-shaped `Record<string, unknown>` at the
 * wire level (every `application/events.ts` payload interface is), so a
 * shallow spread is a faithful, serializable copy for the work item's own
 * `payload` column — no per-event-type payload shape needs restating here.
 */
function toPayloadRecord(payload: unknown): Readonly<Record<string, unknown>> {
  return { ...(payload as Record<string, unknown>) };
}

/**
 * Returns `null` for any event this module doesn't handle (Section 3):
 * `MEMBER_JOINED_EVENT` explicitly, and — defensively — any other event
 * name, so a future new event type is ignored by default rather than
 * mis-mapped.
 *
 * `event.organizationId === null` also returns `null`: every event this
 * function handles is tenant-scoped in practice (`inviteMember`/
 * `acceptInvitation` always publish with a real `organizationId`), but the
 * kernel envelope types it as nullable for platform-scoped events in
 * general — this function has no platform-scoped invitation event to
 * represent, so it declines rather than fabricating one.
 */
export function buildNotificationWorkItemFromEvent(
  event: DomainEvent,
  deps: BuildNotificationWorkItemDeps,
): NotificationWorkItem | null {
  if (event.organizationId === null) return null;
  const organizationId = event.organizationId;

  switch (event.name) {
    case INVITATION_CREATED_EVENT: {
      const payload = event.payload as InvitationCreatedPayload;
      return {
        id: deps.ids.generate(),
        type: "INVITATION_CREATED",
        organizationId,
        invitationId: payload.invitationId,
        recipient: payload.email,
        payload: toPayloadRecord(payload),
        status: "PENDING",
        attempts: 0,
        createdAt: deps.clock.now(),
        processedAt: null,
        lastError: null,
      };
    }
    case INVITATION_ACCEPTED_EVENT: {
      const payload = event.payload as InvitationAcceptedPayload;
      return {
        id: deps.ids.generate(),
        type: "INVITATION_ACCEPTED",
        organizationId,
        invitationId: payload.invitationId,
        recipient: null,
        payload: toPayloadRecord(payload),
        status: "PENDING",
        attempts: 0,
        createdAt: deps.clock.now(),
        processedAt: null,
        lastError: null,
      };
    }
    case INVITATION_EXPIRED_EVENT: {
      const payload = event.payload as InvitationExpiredPayload;
      return {
        id: deps.ids.generate(),
        type: "INVITATION_EXPIRED",
        organizationId,
        invitationId: payload.invitationId,
        recipient: null,
        payload: toPayloadRecord(payload),
        status: "PENDING",
        attempts: 0,
        createdAt: deps.clock.now(),
        processedAt: null,
        lastError: null,
      };
    }
    default:
      return null;
  }
}
