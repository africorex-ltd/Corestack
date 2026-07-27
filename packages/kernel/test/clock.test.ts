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

describe("UuidGenerator (UUIDv7)", () => {
  const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("generates unique RFC 9562 version-7 UUIDs", () => {
    const generator = new UuidGenerator();
    const a = generator.generate();
    const b = generator.generate();
    expect(a).toMatch(uuidV7Pattern);
    expect(b).toMatch(uuidV7Pattern);
    expect(a).not.toBe(b);
  });

  it("ids sort lexicographically in generation order (monotonic within process)", () => {
    const generator = new UuidGenerator();
    const generated = Array.from({ length: 2000 }, () => generator.generate());
    const sorted = [...generated].sort();
    expect(sorted).toEqual(generated);
  });

  it("embeds the current unix-millisecond timestamp in the first 48 bits", () => {
    const before = Date.now();
    const id = new UuidGenerator().generate();
    const after = Date.now();
    const embeddedMs = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    expect(embeddedMs).toBeGreaterThanOrEqual(before);
    expect(embeddedMs).toBeLessThanOrEqual(after + 1);
  });
});

describe("SequentialIdGenerator", () => {
  it("hands out predictable ids for tests", () => {
    const generator = new SequentialIdGenerator("user-");
    expect(generator.generate()).toBe("user-1");
    expect(generator.generate()).toBe("user-2");
  });
});
