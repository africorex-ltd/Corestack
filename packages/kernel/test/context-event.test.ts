import { describe, expect, it } from "vitest";

import {
  causedBy,
  createContext,
  createEvent,
  deserializeEvent,
  FixedClock,
  SequentialIdGenerator,
  serializeEvent,
  systemContext,
  ValidationError,
  type Context,
} from "../src/index.js";

const ids = () => new SequentialIdGenerator("id-");
const clock = () => new FixedClock(new Date("2026-07-28T12:00:00.000Z"));

const userContext = (): Context =>
  createContext(
    { actor: { type: "user", id: "user-1" }, organizationId: "org-1", correlationId: "corr-1" },
    ids(),
  );

describe("Context", () => {
  it("fills defaults and generates a correlation id when absent", () => {
    const context = createContext({ actor: { type: "user", id: "u1" } }, ids());
    expect(context).toEqual({
      actor: { type: "user", id: "u1" },
      organizationId: null,
      correlationId: "id-1",
      causationId: null,
      locale: null,
    });
  });

  it("systemContext has a system actor and no org scope", () => {
    const context = systemContext(ids());
    expect(context.actor).toEqual({ type: "system", id: null });
    expect(context.organizationId).toBeNull();
  });

  it("AUD-10 regression: contexts are frozen — mutation fails loudly", () => {
    const context = userContext();
    expect(() => {
      (context as { organizationId: string | null }).organizationId = "org-evil";
    }).toThrow(TypeError);
    expect(() => {
      (context.actor as { id: string | null }).id = "attacker";
    }).toThrow(TypeError);
    expect(context.organizationId).toBe("org-1");
  });

  it("causedBy preserves the correlation journey and sets causation", () => {
    const parent = userContext();
    const child = causedBy(parent, "event-42");
    expect(child.correlationId).toBe("corr-1");
    expect(child.causationId).toBe("event-42");
    expect(child.actor).toEqual(parent.actor);
  });
});

describe("DomainEvent", () => {
  it("createEvent stamps id, time, actor, correlation, and org from context", () => {
    const event = createEvent(
      { name: "tenancy.member.invited", version: 1, payload: { email: "a@example.com" } },
      userContext(),
      { clock: clock(), ids: ids() },
    );
    expect(event.id).toBe("id-1");
    expect(event.occurredAt.toISOString()).toBe("2026-07-28T12:00:00.000Z");
    expect(event.organizationId).toBe("org-1");
    expect(event.correlationId).toBe("corr-1");
    expect(event.causationId).toBeNull();
    expect(event.actor).toEqual({ type: "user", id: "user-1" });
  });

  it("explicit null organizationId forces platform scope", () => {
    const event = createEvent(
      { name: "platform.migration.applied", version: 1, payload: {}, organizationId: null },
      userContext(),
      { clock: clock(), ids: ids() },
    );
    expect(event.organizationId).toBeNull();
  });

  it.each(["NoDots", "tenancy.MemberRemoved", "tenancy", ".leading", "a.b-c"])(
    "rejects malformed event name %s",
    (name) => {
      expect(() =>
        createEvent({ name, version: 1, payload: {} }, userContext(), {
          clock: clock(),
          ids: ids(),
        }),
      ).toThrow(ValidationError);
    },
  );

  it("rejects non-positive or fractional versions", () => {
    for (const version of [0, -1, 1.5]) {
      expect(() =>
        createEvent({ name: "a.b", version, payload: {} }, userContext(), {
          clock: clock(),
          ids: ids(),
        }),
      ).toThrow(ValidationError);
    }
  });

  it("AUD-10 regression: events are frozen — a mutating consumer fails loudly", () => {
    const event = createEvent(
      { name: "tenancy.member.invited", version: 1, payload: { email: "a@example.com" } },
      userContext(),
      { clock: clock(), ids: ids() },
    );
    expect(() => {
      (event as { organizationId: string | null }).organizationId = "org-evil";
    }).toThrow(TypeError);
    expect(event.organizationId).toBe("org-1");
  });

  it("serialize → JSON → deserialize round-trips exactly", () => {
    const event = createEvent(
      { name: "tenancy.member.removed", version: 2, payload: { userId: "u2" } },
      userContext(),
      { clock: clock(), ids: ids() },
    );
    const revived = deserializeEvent(JSON.parse(JSON.stringify(serializeEvent(event))));
    expect(revived).toEqual(event);
    expect(revived.occurredAt).toBeInstanceOf(Date);
  });

  it("deserialize rejects invalid timestamps", () => {
    const serialized = serializeEvent(
      createEvent({ name: "a.b", version: 1, payload: {} }, userContext(), {
        clock: clock(),
        ids: ids(),
      }),
    );
    expect(() => deserializeEvent({ ...serialized, occurredAt: "not-a-date" })).toThrow(
      ValidationError,
    );
  });
});
