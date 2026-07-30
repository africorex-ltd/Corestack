import { describe, expect, it } from "vitest";

import { OrganizationSlug } from "../../src/domain/organization-slug.js";

describe("OrganizationSlug", () => {
  it.each([["abc"], ["acme-corp"], ["a1-b2-c3"], ["a".repeat(50)]])(
    "accepts a valid slug (%s)",
    (value) => {
      expect(OrganizationSlug.from(value).value).toBe(value);
    },
  );

  it("rejects a slug shorter than 3 characters", () => {
    expect(() => OrganizationSlug.from("ab")).toThrow(/3-50 characters/);
  });

  it("rejects a slug longer than 50 characters", () => {
    expect(() => OrganizationSlug.from("a".repeat(51))).toThrow(/3-50 characters/);
  });

  it.each([
    ["uppercase letters", "Acme-Corp"],
    ["leading hyphen", "-acme"],
    ["trailing hyphen", "acme-"],
    ["consecutive hyphens", "acme--corp"],
    ["underscore", "acme_corp"],
    ["space", "acme corp"],
    ["only hyphens", "---"],
  ])("rejects an invalid slug (%s)", (_label, value) => {
    expect(() => OrganizationSlug.from(value)).toThrow(/invalid organization slug/);
  });

  it("compares equal by value", () => {
    expect(OrganizationSlug.from("acme").equals(OrganizationSlug.from("acme"))).toBe(true);
  });

  it("compares unequal for a different value", () => {
    expect(OrganizationSlug.from("acme").equals(OrganizationSlug.from("other"))).toBe(false);
  });

  it("toString returns the wrapped value", () => {
    expect(OrganizationSlug.from("acme").toString()).toBe("acme");
  });

  it("is frozen (immutable)", () => {
    expect(Object.isFrozen(OrganizationSlug.from("acme"))).toBe(true);
  });
});
