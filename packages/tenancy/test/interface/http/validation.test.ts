import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationError } from "@corestack/kernel";

import {
  parseBody,
  parseEmail,
  parseUuid,
  requireHeader,
} from "../../../src/interface/http/validation.js";

const VALID_UUID = "00000000-0000-7000-8000-000000000001";

describe("parseUuid", () => {
  it("accepts a valid, lowercased UUID", () => {
    expect(parseUuid(VALID_UUID.toUpperCase(), "organizationId")).toBe(VALID_UUID);
  });

  it("throws ValidationError for a malformed value", () => {
    expect(() => parseUuid("not-a-uuid", "organizationId")).toThrow(ValidationError);
  });

  it("throws ValidationError when undefined", () => {
    expect(() => parseUuid(undefined, "organizationId")).toThrow(ValidationError);
  });
});

describe("parseEmail", () => {
  it("trims and lowercases a valid email", () => {
    expect(parseEmail("  User@Example.com  ", "email")).toBe("user@example.com");
  });

  it("throws ValidationError for a malformed email", () => {
    expect(() => parseEmail("not-an-email", "email")).toThrow(ValidationError);
  });

  it("throws ValidationError for a non-string value", () => {
    expect(() => parseEmail(42, "email")).toThrow(ValidationError);
  });
});

describe("requireHeader", () => {
  it("returns the trimmed header value", () => {
    expect(requireHeader({ "x-actor-id": "  value  " }, "x-actor-id")).toBe("value");
  });

  it("throws ValidationError when missing", () => {
    expect(() => requireHeader({}, "x-actor-id")).toThrow(ValidationError);
  });

  it("throws ValidationError when blank", () => {
    expect(() => requireHeader({ "x-actor-id": "   " }, "x-actor-id")).toThrow(ValidationError);
  });
});

describe("parseBody", () => {
  const schema = z.object({ name: z.string().min(1) }).strict();

  it("returns the parsed body on success", () => {
    expect(parseBody(schema, { name: "Acme" })).toEqual({ name: "Acme" });
  });

  it("throws ValidationError (not a raw ZodError) on schema mismatch", () => {
    expect(() => parseBody(schema, { name: "" })).toThrow(ValidationError);
  });

  it("throws ValidationError for unknown fields (.strict())", () => {
    expect(() => parseBody(schema, { name: "Acme", extra: "field" })).toThrow(ValidationError);
  });

  it("includes structured issue metadata, not a raw Zod error", () => {
    try {
      parseBody(schema, { name: "" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.metadata["issues"]).toBeDefined();
    }
  });
});
