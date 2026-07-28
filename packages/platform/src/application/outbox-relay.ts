/**
 * The outbox relay (E03-T12; ADR-0009). Polls `platform.outbox` on a
 * per-consumer cursor and dispatches matching events to each consumer's
 * handler, advancing that consumer's checkpoint only past events it has
 * successfully processed.
 *
 * Contract — normative:
 * - **Per-consumer checkpoints.** Each `EventSubscription.consumer` reads
 *   the outbox on its own cursor (`platform.outbox_checkpoints`); one
 *   consumer's failure or pace never affects another's.
 * - **No checkpoint row yet = start from the beginning of the outbox**,
 *   mirroring T02's "absence of a row means never processed anything"
 *   convention. A consumer registered after events already exist replays
 *   the whole backlog — the correct default for e.g. a newly added audit
 *   consumer that must backfill, not silently miss history.
 * - **Checkpoint advances only past events fully handled.** Events are
 *   processed strictly in `(occurredAt, id)` order; the first handler
 *   failure in a batch stops advancement at the last successfully
 *   processed event (matching or not) — the next poll redelivers from the
 *   failed event onward. This is what makes "no event skipped across
 *   restart" true even across a process crash mid-batch: the checkpoint
 *   is the only durable state, and it is never advanced past unconfirmed
 *   work.
 * - **At-least-once, not exactly-once.** A crash between a handler
 *   succeeding and the checkpoint being persisted redelivers that event;
 *   handlers must be idempotent (E03-T14 is the dedupe helper for this).
 */
import type { DomainEvent, EventSubscription, Logger } from "@corestack/kernel";

import type { Drainable } from "./graceful-shutdown.js";

export interface RelayCursor {
  readonly occurredAt: Date;
  readonly id: string;
}

export interface OutboxRelayStore {
  /** `null` means this consumer has never processed anything. */
  getCheckpoint(consumer: string): Promise<RelayCursor | null>;
  /** Rows strictly after `after` (or from the start if `null`), ordered by `(occurredAt, id)`. */
  fetchBatch(after: RelayCursor | null, limit: number): Promise<readonly DomainEvent[]>;
  advanceCheckpoint(consumer: string, cursor: RelayCursor): Promise<void>;
}

export interface OutboxRelayOptions {
  readonly store: OutboxRelayStore;
  readonly subscriptions: readonly EventSubscription[];
  /** Max events fetched per consumer per round; a consumer keeps rounding until caught up. Default 100. */
  readonly batchSize?: number;
  readonly pollIntervalMs: number;
  readonly logger?: Logger;
  /** Called after each round with how far behind wall-clock now the consumer's new checkpoint is (0 once caught up). */
  readonly onLag?: (consumer: string, lagMs: number) => void;
}

function matches(event: DomainEvent, subscription: EventSubscription): boolean {
  if (subscription.event !== "*" && subscription.event !== event.name) return false;
  if (subscription.versions !== undefined && !subscription.versions.includes(event.version)) {
    return false;
  }
  return true;
}

/** Runs one consumer's fetch-dispatch-checkpoint round, looping until caught up or a handler fails. */
async function runSubscription(
  subscription: EventSubscription,
  store: OutboxRelayStore,
  batchSize: number,
  logger: Logger | undefined,
  onLag: OutboxRelayOptions["onLag"],
): Promise<void> {
  let cursor = await store.getCheckpoint(subscription.consumer);

  for (;;) {
    const batch = await store.fetchBatch(cursor, batchSize);
    if (batch.length === 0) {
      onLag?.(subscription.consumer, 0);
      return;
    }

    let advanced: RelayCursor | null = null;
    let stoppedOnFailure = false;

    for (const event of batch) {
      if (matches(event, subscription)) {
        try {
          await subscription.handler(event);
        } catch (error) {
          logger?.warn(`outbox-relay: consumer "${subscription.consumer}" failed on event`, {
            eventId: event.id,
            eventName: event.name,
            error: error instanceof Error ? error.message : String(error),
          });
          stoppedOnFailure = true;
          break;
        }
      }
      advanced = { occurredAt: event.occurredAt, id: event.id };
    }

    if (advanced !== null) {
      await store.advanceCheckpoint(subscription.consumer, advanced);
      cursor = advanced;
      onLag?.(subscription.consumer, Date.now() - advanced.occurredAt.getTime());
    }

    if (stoppedOnFailure) return;
    if (batch.length < batchSize) return;
    // Batch was full and every event succeeded — more may be waiting; loop.
  }
}

export class OutboxRelay implements Drainable {
  readonly name = "outbox-relay";

  readonly #store: OutboxRelayStore;
  readonly #subscriptions: readonly EventSubscription[];
  readonly #batchSize: number;
  readonly #pollIntervalMs: number;
  readonly #logger: Logger | undefined;
  readonly #onLag: OutboxRelayOptions["onLag"];

  #timer: ReturnType<typeof setTimeout> | null = null;
  #inFlight: Promise<void> | null = null;
  #stopped = false;

  constructor(options: OutboxRelayOptions) {
    this.#store = options.store;
    this.#subscriptions = options.subscriptions;
    this.#batchSize = options.batchSize ?? 100;
    this.#pollIntervalMs = options.pollIntervalMs;
    this.#logger = options.logger;
    this.#onLag = options.onLag;
  }

  /** Runs one full round (every subscription, each looped to caught-up) — exposed directly for tests. */
  async pollOnce(): Promise<void> {
    this.#inFlight = this.#runRound();
    try {
      await this.#inFlight;
    } finally {
      this.#inFlight = null;
    }
  }

  async #runRound(): Promise<void> {
    for (const subscription of this.#subscriptions) {
      // Each consumer's round is isolated: a permanently failing consumer
      // must never stop another's progress.
      try {
        await runSubscription(
          subscription,
          this.#store,
          this.#batchSize,
          this.#logger,
          this.#onLag,
        );
      } catch (error) {
        this.#logger?.warn(`outbox-relay: round failed for consumer "${subscription.consumer}"`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Starts the polling loop. */
  start(): void {
    this.#stopped = false;
    this.#scheduleNext();
  }

  #scheduleNext(): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      void this.pollOnce().finally(() => {
        this.#scheduleNext();
      });
    }, this.#pollIntervalMs);
  }

  /** `Drainable`: stop scheduling new rounds; resolves immediately. */
  async stopIntake(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /** `Drainable`: let any in-flight round finish (and its checkpoint advance) before returning. */
  async drain(): Promise<void> {
    await this.#inFlight;
  }
}
