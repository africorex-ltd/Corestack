import { describe, expect, it } from "vitest";
import { ValidationError } from "@corestack/kernel";

import { assertSafeSqlIdentifier } from "../../src/domain/sql-identifier.js";

describe("assertSafeSqlIdentifier", () => {
  it("accepts lowercase, underscore-separated identifiers", () => {
    expect(() => assertSafeSqlIdentifier("app_role", "role")).not.toThrow();
    expect(() => assertSafeSqlIdentifier("_leading_underscore", "role")).not.toThrow();
  });

  it.each(["App_Role", "app-role", "1app", "app;DROP TABLE x;--", "app role", ""])(
    "rejects %s",
    (identifier) => {
      expect(() => assertSafeSqlIdentifier(identifier, "role")).toThrow(ValidationError);
    },
  );

  it("includes the offending identifier and purpose in the error metadata", () => {
    try {
      assertSafeSqlIdentifier("bad;role", "applicationRole");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.metadata.identifier).toBe("bad;role");
      expect(validationError.metadata.purpose).toBe("applicationRole");
    }
  });
});
