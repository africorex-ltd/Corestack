import { describe, expect, it } from "vitest";
import { createContext, createEvent, FixedClock, SequentialIdGenerator } from "@corestack/kernel";

import { toOutboxRow } from "../../src/domain/outbox-event.js";

const clock = new FixedClock(new Date("2026-07-15T12:00:00Z"));
const ids = new SequentialIdGenerator("evt");

describe("toOutboxRow", () => {
  it("maps every DomainEvent envelope field to its outbox column", () => {
    const context = createContext(
      { actor: { type: "user", id: "user-1" }, organizationId: "org-1" },
      ids,
    );
    const event = createEvent(
      { name: "tenancy.member.invited", version: 1, payload: { email: "a@b.com" } },
      context,
      { clock, ids },
    );

    const row = toOutboxRow(event);

    expect(row).toEqual({
      id: event.id,
      event_name: "tenancy.member.invited",
      event_version: 1,
      occurred_at: "2026-07-15T12:00:00.000Z",
      organization_id: "org-1",
      actor_type: "user",
      actor_id: "user-1",
      correlation_id: event.correlationId,
      causation_id: null,
      payload: { email: "a@b.com" },
    });
  });

  it("maps a system actor's null id and a platform-scoped (null org) event", () => {
    const context = createContext({ actor: { type: "system", id: null } }, ids);
    const event = createEvent(
      { name: "platform.tenant.purged", version: 1, payload: {}, organizationId: null },
      context,
      { clock, ids },
    );

    const row = toOutboxRow(event);

    expect(row.actor_type).toBe("system");
    expect(row.actor_id).toBeNull();
    expect(row.organization_id).toBeNull();
  });

  it("carries causationId through when the event was caused by another message", () => {
    const context = createContext(
      { actor: { type: "api_key", id: "key-1" }, causationId: "cause-1" },
      ids,
    );
    const event = createEvent(
      { name: "billing.invoice.issued", version: 1, payload: null },
      context,
      {
        clock,
        ids,
      },
    );

    expect(toOutboxRow(event).causation_id).toBe("cause-1");
  });

  it("leaves a nested, non-ASCII, null-containing payload untouched — not pre-stringified", () => {
    const payload = {
      nested: { count: 3, tags: ["a", "b"] },
      empty: {},
      missing: null,
      label: "héllo wörld — 日本語",
    };
    const context = createContext({ actor: { type: "system", id: null } }, ids);
    const event = createEvent({ name: "tenancy.member.invited", version: 1, payload }, context, {
      clock,
      ids,
    });

    const row = toOutboxRow(event);

    expect(row.payload).toEqual(payload);
  });
});
