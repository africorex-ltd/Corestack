import { NotificationDeliveryPermanentError } from "./notification-delivery-port.js";
import type { NotificationWorkItem } from "./notification-work-item.js";

/**
 * Two pure, zero-I/O decision functions the processor
 * (`infrastructure/postgres/process-notification-work-item.ts`) calls
 * around its actual I/O (the repository claim/mark calls, the delivery
 * port invocation). Kept pure and unit-testable without Postgres, the
 * same pure/impure split E05-T14 established for
 * `buildNotificationWorkItemFromEvent`.
 */

/**
 * Retryable delivery failures get this many total attempts (the first
 * attempt plus this many minus one retries) before the work item is
 * marked terminally `FAILED` instead of returned to `PENDING`. Chosen as
 * a reasonable, documented default — Section 7 requires distinguishing
 * "transient failure" from "repeated failure" but does not specify a
 * number; this constant is the single place that number lives, exported
 * so tests reference it instead of a duplicated magic number.
 */
export const MAX_NOTIFICATION_DELIVERY_ATTEMPTS = 5;

export interface NotificationFailureOutcome {
  readonly status: "PENDING" | "FAILED";
  readonly lastError: string;
}

/**
 * Section 7's "transient failure" vs "repeated failure" distinction,
 * decided here rather than in the repository (Section 3 gives the
 * repository only `markFailed`, taking whatever status the caller already
 * decided — persistence, not policy).
 *
 * `NotificationDeliveryPermanentError` (unknown type, or a work item whose
 * shape can't support its own claimed delivery) always resolves to
 * `FAILED` regardless of `attempts` — retrying can never fix either
 * condition, so counting toward the retry budget would only delay an
 * outcome that's already decided. Every other error is treated as
 * transient: `attemptsAfterThisFailure < MAX_NOTIFICATION_DELIVERY_ATTEMPTS`
 * returns to `PENDING` (Section 4: "retries remain visible" — a future
 * `claimNextPending` call can pick it up again); reaching the threshold
 * resolves to `FAILED` (Section 4: "failed rows are not lost" — the row
 * stays in the table, terminal, for operator inspection, never deleted).
 */
export function decideNotificationFailureOutcome(
  attemptsAfterThisFailure: number,
  error: unknown,
): NotificationFailureOutcome {
  const lastError = error instanceof Error ? error.message : String(error);

  if (error instanceof NotificationDeliveryPermanentError) {
    return { status: "FAILED", lastError };
  }

  const status = attemptsAfterThisFailure < MAX_NOTIFICATION_DELIVERY_ATTEMPTS ? "PENDING" : "FAILED";
  return { status, lastError };
}

/**
 * Validates a claimed work item can actually be dispatched before any
 * delivery I/O is attempted, throwing `NotificationDeliveryPermanentError`
 * for either of Section 7's non-retryable shape problems:
 *
 * - **Unknown type**: `item.type` matches none of the three handled
 *   constants. Unreachable via the table's own `CHECK` constraint today
 *   (only three values are legal), but not via a hand-crafted row, nor a
 *   future migration that adds a fourth type before this function is
 *   updated to match — defended against here rather than assumed away.
 * - **`INVITATION_CREATED` with a `null` recipient**: `recipient` is
 *   nullable independently of `type` at the column level (nothing in the
 *   schema ties the two together), even though E05-T14's own writer
 *   (`buildNotificationWorkItemFromEvent`) never produces this
 *   combination. A work item in this shape can never be delivered no
 *   matter how many times it's retried.
 *
 * Called before the delivery port is invoked, so a permanent-error work
 * item never reaches an I/O call at all.
 */
export function assertNotificationWorkItemDeliverable(item: NotificationWorkItem): void {
  switch (item.type) {
    case "INVITATION_CREATED":
      if (item.recipient === null) {
        throw new NotificationDeliveryPermanentError(
          `INVITATION_CREATED work item ${item.id} has no recipient`,
        );
      }
      return;
    case "INVITATION_ACCEPTED":
      return;
    case "INVITATION_EXPIRED":
      return;
    default: {
      const unknownType: string = item.type;
      throw new NotificationDeliveryPermanentError(
        `unknown notification work item type: ${unknownType}`,
      );
    }
  }
}
