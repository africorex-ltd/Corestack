import { describe, expect, it } from "vitest";

import { MembershipId } from "../../src/domain/membership-id.js";

describe("MembershipId", () => {
  it("accepts a valid UUID", () => {
    const id = MembershipId.from("018f5a3e-7b2c-7000-8000-000000000001");
    expect(id.value).toBe("018f5a3e-7b2c-7000-8000-000000000001");
  });

  it("normalizes case to lowercase", () => {
    const id = MembershipId.from("018F5A3E-7B2C-7000-8000-000000000001");
    expect(id.value).toBe("018f5a3e-7b2c-7000-8000-000000000001");
  });

  it.each([
    ["empty string", ""],
    ["too short", "018f5a3e-7b2c-7000-8000"],
    ["missing dashes", "018f5a3e7b2c70008000000000000001"],
    ["non-hex characters", "018f5a3e-7b2c-7000-8000-00000000000g"],
  ])("rejects an invalid id (%s)", (_label, value) => {
    expect(() => MembershipId.from(value)).toThrow(/invalid membership id/);
  });

  it("compares equal by value, case-insensitively", () => {
    const a = MembershipId.from("018f5a3e-7b2c-7000-8000-000000000001");
    const b = MembershipId.from("018F5A3E-7B2C-7000-8000-000000000001");
    expect(a.equals(b)).toBe(true);
  });

  it("compares unequal for a different value", () => {
    const a = MembershipId.from("018f5a3e-7b2c-7000-8000-000000000001");
    const b = MembershipId.from("018f5a3e-7b2c-7000-8000-000000000002");
    expect(a.equals(b)).toBe(false);
  });

  it("toString returns the wrapped value", () => {
    const id = MembershipId.from("018f5a3e-7b2c-7000-8000-000000000001");
    expect(id.toString()).toBe("018f5a3e-7b2c-7000-8000-000000000001");
  });

  it("is frozen (immutable)", () => {
    const id = MembershipId.from("018f5a3e-7b2c-7000-8000-000000000001");
    expect(Object.isFrozen(id)).toBe(true);
  });
});
