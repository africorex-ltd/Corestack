import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createContext,
  createEvent,
  FixedClock,
  InMemoryEventBus,
  SequentialIdGenerator,
  type DomainEvent,
  type EventBus,
  type EventSubscription,
} from "../src/index.js";
import { defineEventBusContractSuite, type SuiteHarness } from "../src/testing/index.js";

const harness: SuiteHarness = { describe, it, expect, beforeEach, afterEach };

function makeEvent(name: string, version = 1): DomainEvent {
  return createEvent(
    { name, version, payload: {} },
    createContext(
      { actor: { type: "system", id: null }, correlationId: "corr" },
      new SequentialIdGenerator(),
    ),
    {
      clock: new FixedClock(new Date("2026-07-28T00:00:00Z")),
      ids: new SequentialIdGenerator("evt-"),
    },
  );
}

describe("InMemoryEventBus via the shared EventBus contract suite", () => {
  defineEventBusContractSuite(harness, () => new InMemoryEventBus(), makeEvent);
});

/**
 * A deliberately broken `EventBus`: delivers to subscriptions in REVERSE
 * subscription order instead of the normative order. This is not run
 * through `defineEventBusContractSuite` — doing so would register
 * permanently-failing tests in this file's normal run. Instead, this one
 * targeted assertion proves the fixture actually violates the contract
 * the shared suite's "sequentially, in subscription order" test checks —
 * demonstrating that assertion has real teeth, the same
 * verify-against-an-unsafe-variant discipline used everywhere else in this
 * codebase, without shipping a red test to CI.
 */
class ReverseOrderEventBus implements EventBus {
  #subscriptions: EventSubscription[] = [];

  subscribe(subscription: EventSubscription) {
    this.#subscriptions.push(subscription);
    return () => {
      this.#subscriptions = this.#subscriptions.filter((s) => s !== subscription);
    };
  }

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      for (const subscription of [...this.#subscriptions].reverse()) {
        if (subscription.event !== "*" && subscription.event !== event.name) continue;
        await subscription.handler(event);
      }
    }
  }
}

describe("EventBus contract regression proof", () => {
  it("SECURITY-equivalent proof: a bus that delivers out of subscription order fails the ordering contract the shared suite checks", async () => {
    const bus = new ReverseOrderEventBus();
    const calls: string[] = [];
    bus.subscribe({ consumer: "first", event: "a.b", handler: () => void calls.push("first") });
    bus.subscribe({ consumer: "second", event: "a.b", handler: () => void calls.push("second") });

    await bus.publish([makeEvent("a.b")]);

    // The shared suite asserts `["first", "second"]` — this fixture produces
    // the reverse, proving the assertion is not vacuously true.
    expect(calls).toEqual(["second", "first"]);
    expect(calls).not.toEqual(["first", "second"]);
  });
});
