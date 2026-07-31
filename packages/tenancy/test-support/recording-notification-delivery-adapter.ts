import type {
  InvitationAcceptedDeliveryPayload,
  InvitationCreatedDeliveryPayload,
  InvitationExpiredDeliveryPayload,
  NotificationDeliveryPort,
} from "../src/application/notification-delivery-port.js";

export type RecordedNotificationDelivery =
  | { readonly method: "deliverInvitationCreated"; readonly payload: InvitationCreatedDeliveryPayload }
  | { readonly method: "deliverInvitationAccepted"; readonly payload: InvitationAcceptedDeliveryPayload }
  | { readonly method: "deliverInvitationExpired"; readonly payload: InvitationExpiredDeliveryPayload };

/**
 * The E05-T15 Section 5 "test adapter that records deliveries" —
 * `NotificationDeliveryPort`'s only implementation anywhere in this
 * codebase today (Section 13: no real provider). Records every call in
 * order for test assertions and, via `failNextWith`, can simulate a
 * transient delivery failure (any error) or a permanent one
 * (`NotificationDeliveryPermanentError`) on demand — the processor's own
 * unit/integration tests use this to exercise both branches of
 * `decideNotificationFailureOutcome` without a real provider existing.
 *
 * Lives in `test-support/`, not `src/testing/` — same reasoning as every
 * other in-memory double in this directory (internal, project-only, not
 * adopter-facing; see `tenancy-workflow-integration.md`'s "Why
 * `test-support/`, not `src/testing/`" section).
 */
export class RecordingNotificationDeliveryAdapter implements NotificationDeliveryPort {
  readonly deliveries: RecordedNotificationDelivery[] = [];
  #failNextWith: Error | null = null;

  /** The next delivery call (any method) throws this error instead of recording; cleared after throwing once. */
  failNextWith(error: Error): void {
    this.#failNextWith = error;
  }

  #maybeThrow(): void {
    if (this.#failNextWith !== null) {
      const error = this.#failNextWith;
      this.#failNextWith = null;
      throw error;
    }
  }

  async deliverInvitationCreated(payload: InvitationCreatedDeliveryPayload): Promise<void> {
    this.#maybeThrow();
    this.deliveries.push({ method: "deliverInvitationCreated", payload });
  }

  async deliverInvitationAccepted(payload: InvitationAcceptedDeliveryPayload): Promise<void> {
    this.#maybeThrow();
    this.deliveries.push({ method: "deliverInvitationAccepted", payload });
  }

  async deliverInvitationExpired(payload: InvitationExpiredDeliveryPayload): Promise<void> {
    this.#maybeThrow();
    this.deliveries.push({ method: "deliverInvitationExpired", payload });
  }
}
