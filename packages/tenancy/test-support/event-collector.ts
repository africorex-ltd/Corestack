import { expect } from "vitest";
import type { DomainEvent } from "@corestack/kernel";

/**
 * Captures every event published through a harness's `EventBus`, in
 * publication order (E05-T08 Section 5). A thin wrapper over an array,
 * not a generic pub/sub abstraction (Section 12: "do not introduce
 * shared generic repositories" applies in spirit here too) — its only
 * job is recording what happened and giving tests a few named assertions
 * instead of hand-rolling `expect(names).toEqual([...])` in every test.
 *
 * `expect` from vitest is used directly (not re-implemented with bare
 * `throw`) — this class lives in `test-support/`, which is test-only
 * code with vitest as an available dependency, unlike `src/`.
 */
export class EventCollector {
  #events: DomainEvent[] = [];

  /** Subscribe this via `EventBus.subscribe({ consumer: "...", event: "*", handler: collector.record })`. */
  readonly record = (event: DomainEvent): void => {
    this.#events.push(event);
  };

  /** Every event captured so far, in publication order. A fresh array each call — never a live reference to internal storage. */
  get all(): readonly DomainEvent[] {
    return [...this.#events];
  }

  /** Event names in publication order. */
  get names(): readonly string[] {
    return this.#events.map((event) => event.name);
  }

  get count(): number {
    return this.#events.length;
  }

  /** Resets captured events — useful between workflow steps within one test, when only the events from the *next* step matter. */
  clear(): void {
    this.#events = [];
  }

  /** Asserts the exact, ordered sequence of event names — nothing more, nothing less, nothing out of order. */
  expectSequence(names: readonly string[]): void {
    expect(this.names).toEqual(names);
  }

  /** Asserts no events were published at all. */
  expectNone(): void {
    expect(this.names).toEqual([]);
  }

  /** Asserts exactly `count` events were published, independent of name/order. */
  expectCount(count: number): void {
    expect(this.count).toBe(count);
  }

  /** The payload of the event at `index`, for payload-shape assertions (`expect(collector.payloadAt(0)).toMatchObject({...})`). Throws if out of range — a test asserting a payload it doesn't have is a bug in the test. */
  payloadAt(index: number): unknown {
    const event = this.#events[index];
    if (event === undefined) {
      throw new Error(`no event captured at index ${index} (only ${this.#events.length} captured)`);
    }
    return event.payload;
  }
}
