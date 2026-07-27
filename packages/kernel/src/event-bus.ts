/**
 * The `EventBus` port (Architecture §13; ADR-0009).
 *
 * Delivery semantics — normative for all implementations:
 * - `publish` delivers each event to every matching subscription
 *   **sequentially, in subscription order**; a batch is delivered event by
 *   event in batch order.
 * - Matching: exact `name` match or the `"*"` wildcard; if `versions` is
 *   declared, only those contract versions are delivered (undeclared =
 *   all versions — consumers that care must declare).
 * - Every matching handler is attempted even if an earlier one throws;
 *   failures are then rethrown as a single `AggregateError`.
 * - This port is the *in-process* delivery mechanism. Reliability
 *   (at-least-once, redelivery, checkpoints) is the transactional outbox
 *   relay's job (ADR-0009); handlers must therefore be idempotent — see
 *   `idempotentHandler` in `processed-events.ts`.
 */

import type { DomainEvent } from "./event.js";

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

export interface EventSubscription {
  /** Stable consumer name — also the checkpoint/idempotency identity. */
  readonly consumer: string;
  /** Exact event name, or `"*"` for all events (audit, webhooks). */
  readonly event: string;
  /** Accepted contract versions; omit to accept all. */
  readonly versions?: readonly number[];
  readonly handler: EventHandler;
}

export type Unsubscribe = () => void;

export interface EventBus {
  publish(events: readonly DomainEvent[]): Promise<void>;
  subscribe(subscription: EventSubscription): Unsubscribe;
}

/** In-memory reference implementation of the normative semantics above. */
export class InMemoryEventBus implements EventBus {
  #subscriptions: EventSubscription[] = [];

  subscribe(subscription: EventSubscription): Unsubscribe {
    this.#subscriptions.push(subscription);
    return () => {
      this.#subscriptions = this.#subscriptions.filter((s) => s !== subscription);
    };
  }

  async publish(events: readonly DomainEvent[]): Promise<void> {
    const failures: unknown[] = [];
    for (const event of events) {
      for (const subscription of this.#subscriptions) {
        if (subscription.event !== "*" && subscription.event !== event.name) continue;
        if (subscription.versions !== undefined && !subscription.versions.includes(event.version)) {
          continue;
        }
        try {
          await subscription.handler(event);
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `${failures.length} event handler(s) failed`);
    }
  }
}
