import { describe, expect, it } from "vitest";
import { createContext, createEvent, FixedClock, SequentialIdGenerator } from "@corestack/kernel";

import { fromOutboxRow, toOutboxRow, type OutboxTableRow } from "../../src/domain/outbox-event.js";

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

describe("fromOutboxRow", () => {
  it("maps a raw table row back to a DomainEvent envelope", () => {
    const row: OutboxTableRow = {
      id: "evt-1",
      event_name: "tenancy.member.invited",
      event_version: 1,
      occurred_at: new Date("2026-07-15T12:00:00Z"),
      organization_id: "org-1",
      actor_type: "user",
      actor_id: "user-1",
      correlation_id: "corr-1",
      causation_id: "cause-1",
      payload: { email: "a@b.com" },
    };

    expect(fromOutboxRow(row)).toEqual({
      id: "evt-1",
      name: "tenancy.member.invited",
      version: 1,
      occurredAt: new Date("2026-07-15T12:00:00Z"),
      organizationId: "org-1",
      actor: { type: "user", id: "user-1" },
      correlationId: "corr-1",
      causationId: "cause-1",
      payload: { email: "a@b.com" },
    });
  });

  it("is the exact inverse of toOutboxRow across the DB round trip (Date <-> ISO string)", () => {
    const context = createContext(
      { actor: { type: "api_key", id: "key-1" }, organizationId: "org-2", causationId: "cause-2" },
      ids,
    );
    const event = createEvent(
      { name: "billing.invoice.issued", version: 2, payload: { amount: 42 } },
      context,
      { clock, ids },
    );

    const inserted = toOutboxRow(event);
    // Simulate what Postgres/postgres.js hands back on SELECT: occurred_at
    // as a Date, everything else unchanged.
    const readBack: OutboxTableRow = { ...inserted, occurred_at: new Date(inserted.occurred_at) };

    expect(fromOutboxRow(readBack)).toEqual(event);
  });
});
