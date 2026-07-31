import { describe, expect, it } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@corestack/kernel";

import { mapErrorToHttpResponse } from "../../../src/interface/http/errors.js";

describe("mapErrorToHttpResponse", () => {
  it("maps ValidationError to 400", () => {
    const response = mapErrorToHttpResponse(new ValidationError("bad input"));
    expect(response.status).toBe(400);
  });

  it("maps NotFoundError to 404", () => {
    const response = mapErrorToHttpResponse(new NotFoundError("not found"));
    expect(response.status).toBe(404);
  });

  it("maps ConflictError to 409", () => {
    const response = mapErrorToHttpResponse(new ConflictError("conflict"));
    expect(response.status).toBe(409);
  });

  it("maps ForbiddenError to 403", () => {
    const response = mapErrorToHttpResponse(new ForbiddenError("forbidden"));
    expect(response.status).toBe(403);
  });

  it("maps UnauthorizedError to 401", () => {
    const response = mapErrorToHttpResponse(new UnauthorizedError("unauthorized"));
    expect(response.status).toBe(401);
  });

  it("maps an unrecognized error to 500 with a generic, non-leaking body", () => {
    const response = mapErrorToHttpResponse(new Error("raw infra failure: password=hunter2"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("hunter2");
    expect(response.body).toEqual({
      code: "core/internal",
      message: "an unexpected error occurred",
    });
  });

  it("maps a non-Error thrown value to 500 with the same generic body", () => {
    const response = mapErrorToHttpResponse("a raw string throw");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      code: "core/internal",
      message: "an unexpected error occurred",
    });
  });

  it("includes the kernel error's own code/message/metadata for expected errors", () => {
    const error = new ConflictError("slug already exists", { metadata: { slug: "acme" } });
    const response = mapErrorToHttpResponse(error);
    expect(response.body).toEqual({
      code: error.code,
      message: "slug already exists",
      metadata: { slug: "acme" },
    });
  });
});
