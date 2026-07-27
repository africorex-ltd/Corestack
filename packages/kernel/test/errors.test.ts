import { describe, expect, it } from "vitest";

import {
  ConflictError,
  CoreError,
  ForbiddenError,
  isCoreError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../src/index.js";

describe("CoreError taxonomy", () => {
  it("assigns stable codes per class", () => {
    expect(new ValidationError("bad input").code).toBe("core/validation");
    expect(new NotFoundError("missing").code).toBe("core/not_found");
    expect(new ConflictError("duplicate").code).toBe("core/conflict");
    expect(new UnauthorizedError("who?").code).toBe("core/unauthorized");
    expect(new ForbiddenError("no").code).toBe("core/forbidden");
  });

  it("sets name to the concrete class and preserves message", () => {
    const error = new NotFoundError("user not found");
    expect(error.name).toBe("NotFoundError");
    expect(error.message).toBe("user not found");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CoreError);
  });

  it("carries cause and metadata when provided", () => {
    const cause = new Error("db timeout");
    const error = new ConflictError("email already registered", {
      cause,
      metadata: { field: "email" },
    });
    expect(error.cause).toBe(cause);
    expect(error.metadata).toEqual({ field: "email" });
  });

  it("defaults metadata to an empty object and cause to undefined", () => {
    const error = new ValidationError("bad");
    expect(error.metadata).toEqual({});
    expect(error.cause).toBeUndefined();
  });

  it("isCoreError narrows correctly", () => {
    expect(isCoreError(new ForbiddenError("no"))).toBe(true);
    expect(isCoreError(new Error("plain"))).toBe(false);
    expect(isCoreError("string")).toBe(false);
  });
});
