/**
 * The `UnitOfWork` port (Architecture §3; ADR-0009).
 *
 * Contract — normative for all implementations:
 * - One unit of work per use case; `run` scopes all of the use case's
 *   writes into one atomic commit.
 * - Events staged via `tx.publish` are made durable **in the same
 *   transaction** as the state changes (real adapters: the outbox table)
 *   and dispatched only after commit; if `work` throws, both the writes
 *   and the staged events are discarded.
 * - **Consumer failures never fail the producer** (AUD-03): once `work`
 *   has committed, the use case has succeeded — dispatch/consumer errors
 *   are an observability concern (relay retries, dead-letters), never a
 *   use-case error. Implementations must isolate them.
 * - Nesting is not supported (a use case is the transaction boundary).
 */

import type { EventBus } from "./event-bus.js";
import type { DomainEvent } from "./event.js";

export interface TransactionContext {
  /** Stage events for atomic persistence and after-commit dispatch. */
  publish(...events: DomainEvent[]): void;
}

export interface UnitOfWork {
  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export interface InMemoryUnitOfWorkOptions {
  /**
   * Observer for after-commit dispatch failures (typically an
   * `AggregateError` from the in-memory bus). Defaults to swallowing —
   * matching production, where the outbox relay owns retries and the
   * producer never sees consumer errors.
   */
  readonly onDispatchError?: (error: unknown, events: readonly DomainEvent[]) => void;
}

/**
 * Reference implementation for tests and non-durable composition: staged
 * events are dispatched to the bus after `work` resolves and discarded if it
 * throws. Durability across crashes is the Postgres adapter's job.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  readonly #bus: EventBus;
  readonly #onDispatchError: InMemoryUnitOfWorkOptions["onDispatchError"];

  constructor(bus: EventBus, options: InMemoryUnitOfWorkOptions = {}) {
    this.#bus = bus;
    this.#onDispatchError = options.onDispatchError;
  }

  async run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const staged: DomainEvent[] = [];
    const tx: TransactionContext = {
      publish: (...events) => {
        staged.push(...events);
      },
    };
    const result = await work(tx);
    try {
      await this.#bus.publish(staged);
    } catch (error) {
      this.#onDispatchError?.(error, staged);
    }
    return result;
  }
}
