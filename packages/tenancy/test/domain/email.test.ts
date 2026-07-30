import { describe, expect, it } from "vitest";

import { Email } from "../../src/domain/email.js";

describe("Email", () => {
  it("accepts a valid email", () => {
    const email = Email.from("someone@example.com");
    expect(email.value).toBe("someone@example.com");
  });

  it("normalizes to lowercase", () => {
    const email = Email.from("Someone@Example.COM");
    expect(email.value).toBe("someone@example.com");
  });

  it("trims surrounding whitespace", () => {
    const email = Email.from("  someone@example.com  ");
    expect(email.value).toBe("someone@example.com");
  });

  it.each([
    ["empty string", ""],
    ["missing @", "someone.example.com"],
    ["missing domain dot", "someone@examplecom"],
    ["contains internal whitespace", "some one@example.com"],
    ["missing local part", "@example.com"],
    ["missing domain", "someone@"],
  ])("rejects an invalid email (%s)", (_label, value) => {
    expect(() => Email.from(value)).toThrow(/invalid email/);
  });

  it("compares equal by normalized value", () => {
    const a = Email.from("Someone@Example.com");
    const b = Email.from("someone@example.com");
    expect(a.equals(b)).toBe(true);
  });

  it("compares unequal for a different value", () => {
    const a = Email.from("someone@example.com");
    const b = Email.from("other@example.com");
    expect(a.equals(b)).toBe(false);
  });

  it("toString returns the normalized value", () => {
    const email = Email.from("Someone@Example.COM");
    expect(email.toString()).toBe("someone@example.com");
  });

  it("is frozen (immutable)", () => {
    const email = Email.from("someone@example.com");
    expect(Object.isFrozen(email)).toBe(true);
  });
});
