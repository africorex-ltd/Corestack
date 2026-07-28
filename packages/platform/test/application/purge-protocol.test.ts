import { describe, expect, it, vi } from "vitest";
import {
  createContext,
  createEvent,
  FixedClock,
  InMemoryProcessedEventStore,
  SequentialIdGenerator,
  ValidationError,
} from "@corestack/kernel";

import {
  ORGANIZATION_PURGE_REQUESTED_EVENT,
  registerPurgeHandler,
} from "../../src/application/purge-protocol.js";

const ids = () => new SequentialIdGenerator("evt-");

function makePurgeEvent(organizationId: string | null) {
  const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));
  const context = createContext({ actor: { type: "system", id: null }, organizationId }, ids());
  return createEvent(
    { name: ORGANIZATION_PURGE_REQUESTED_EVENT, version: 1, payload: {} },
    context,
    { clock, ids: ids() },
  );
}

describe("registerPurgeHandler (E03-T33)", () => {
  it("builds a subscription with a per-module namespaced consumer and the purge event name", () => {
    const store = new InMemoryProcessedEventStore();
    const subscription = registerPurgeHandler("billing", async () => {}, store);
    expect(subscription.consumer).toBe("billing:purge");
    expect(subscription.event).toBe(ORGANIZATION_PURGE_REQUESTED_EVENT);
  });

  it("rejects an invalid module name", () => {
    const store = new InMemoryProcessedEventStore();
    expect(() => registerPurgeHandler("Not Valid", async () => {}, store)).toThrow(ValidationError);
  });

  it("throws ValidationError and never calls the handler when the event has no organizationId", async () => {
    const store = new InMemoryProcessedEventStore();
    const handler = vi.fn(async () => {});
    const subscription = registerPurgeHandler("billing", handler, store);
    const event = makePurgeEvent(null);

    await expect(subscription.handler(event)).rejects.toThrow(ValidationError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("invokes the handler with the event's organizationId", async () => {
    const store = new InMemoryProcessedEventStore();
    const handler = vi.fn(async () => {});
    const subscription = registerPurgeHandler("billing", handler, store);
    const event = makePurgeEvent("org-1");

    await subscription.handler(event);
    expect(handler).toHaveBeenCalledWith("org-1", event);
  });

  it("is idempotent on replay: the same event delivered twice invokes the handler exactly once", async () => {
    const store = new InMemoryProcessedEventStore();
    const handler = vi.fn(async () => {});
    const subscription = registerPurgeHandler("billing", handler, store);
    const event = makePurgeEvent("org-1");

    await subscription.handler(event);
    await subscription.handler(event); // redelivery of the same event id

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("leaves the event unmarked (retryable) when the handler throws", async () => {
    const store = new InMemoryProcessedEventStore();
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });
    const subscription = registerPurgeHandler("billing", handler, store);
    const event = makePurgeEvent("org-1");

    await expect(subscription.handler(event)).rejects.toThrow("boom");
    expect(await store.hasProcessed("billing:purge", event.id)).toBe(false);

    // A retry after the failure is not treated as a duplicate — it's
    // attempted again (and fails again, since this fixture handler always
    // throws), proving the first failure didn't get silently marked done.
    await expect(subscription.handler(event)).rejects.toThrow("boom");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("two different modules registering purge handlers get independent consumer namespaces", () => {
    const store = new InMemoryProcessedEventStore();
    const billing = registerPurgeHandler("billing", async () => {}, store);
    const audit = registerPurgeHandler("audit", async () => {}, store);
    expect(billing.consumer).not.toBe(audit.consumer);
  });
});
