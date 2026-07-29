import { describe, expect, it } from "vitest";

import { validateCreateContactInput } from "../../src/domain/contact.js";

describe("validateCreateContactInput", () => {
  it("passes a valid name and email", () => {
    expect(validateCreateContactInput({ name: "Ada Lovelace", email: "ada@example.com" })).toEqual(
      [],
    );
  });

  it("aggregates both a blank name and a malformed email in one call", () => {
    const issues = validateCreateContactInput({ name: "  ", email: "not-an-email" });
    expect(issues).toEqual([
      { field: "name", message: "name must not be empty" },
      { field: "email", message: "email is not a valid address" },
    ]);
  });
});
