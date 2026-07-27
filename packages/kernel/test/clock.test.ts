import { describe, expect, it } from "vitest";

import { FixedClock, SequentialIdGenerator, SystemClock, UuidGenerator } from "../src/index.js";

describe("SystemClock", () => {
  it("returns the current time", () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe("FixedClock", () => {
  it("returns the fixed time and advances deterministically", () => {
    const start = new Date("2026-07-28T12:00:00.000Z");
    const clock = new FixedClock(start);

    expect(clock.now().toISOString()).toBe("2026-07-28T12:00:00.000Z");

    clock.advance(90_000);
    expect(clock.now().toISOString()).toBe("2026-07-28T12:01:30.000Z");

    clock.set(new Date("2027-01-01T00:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("returns defensive copies — mutating the returned Date does not affect the clock", () => {
    const clock = new FixedClock(new Date("2026-07-28T12:00:00.000Z"));
    clock.now().setFullYear(1999);
    expect(clock.now().toISOString()).toBe("2026-07-28T12:00:00.000Z");
  });
});

describe("UuidGenerator", () => {
  it("generates unique RFC 4122 UUIDs", () => {
    const generator = new UuidGenerator();
    const a = generator.generate();
    const b = generator.generate();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(a).toMatch(uuidPattern);
    expect(b).toMatch(uuidPattern);
    expect(a).not.toBe(b);
  });
});

describe("SequentialIdGenerator", () => {
  it("hands out predictable ids for tests", () => {
    const generator = new SequentialIdGenerator("user-");
    expect(generator.generate()).toBe("user-1");
    expect(generator.generate()).toBe("user-2");
  });
});
