import { describe, expect, it } from "vitest";
import { UuidGenerator, ValidationError } from "@corestack/kernel";

import {
  buildContext,
  buildOrgScopedContext,
  extractActorId,
  extractOrganizationId,
  extractRequestId,
} from "../../../src/interface/http/context.js";
import type { HttpRequest } from "../../../src/interface/http/types.js";

const ids = new UuidGenerator();
const ACTOR_ID = "00000000-0000-7000-8000-000000000001";
const ORG_ID = "00000000-0000-7000-8000-000000000002";

function request(headers: Record<string, string | undefined>): HttpRequest {
  return { params: {}, headers };
}

describe("extractActorId", () => {
  it("returns the UUID-validated actor id", () => {
    expect(extractActorId(request({ "x-actor-id": ACTOR_ID }))).toBe(ACTOR_ID);
  });

  it("throws ValidationError when missing", () => {
    expect(() => extractActorId(request({}))).toThrow(ValidationError);
  });

  it("throws ValidationError when not UUID-shaped", () => {
    expect(() => extractActorId(request({ "x-actor-id": "not-a-uuid" }))).toThrow(ValidationError);
  });
});

describe("extractOrganizationId", () => {
  it("returns the UUID-validated organization id", () => {
    expect(extractOrganizationId(request({ "x-organization-id": ORG_ID }))).toBe(ORG_ID);
  });

  it("throws ValidationError when missing", () => {
    expect(() => extractOrganizationId(request({}))).toThrow(ValidationError);
  });
});

describe("extractRequestId", () => {
  it("uses X-Request-Id when present", () => {
    expect(extractRequestId(request({ "x-request-id": "req-123" }), ids)).toBe("req-123");
  });

  it("generates one when absent", () => {
    const requestId = extractRequestId(request({}), ids);
    expect(requestId.length).toBeGreaterThan(0);
  });
});

describe("buildContext", () => {
  it("builds a plain, pre-org-scope Context from actor/request headers", () => {
    const context = buildContext(
      request({ "x-actor-id": ACTOR_ID, "x-request-id": "req-1" }),
      ids,
    );
    expect(context.actor).toEqual({ type: "user", id: ACTOR_ID });
    expect(context.organizationId).toBeNull();
    expect(context.correlationId).toBe("req-1");
  });
});

describe("buildOrgScopedContext", () => {
  it("builds an OrgScopedContext from actor/organization/request headers", () => {
    const context = buildOrgScopedContext(
      request({
        "x-actor-id": ACTOR_ID,
        "x-organization-id": ORG_ID,
        "x-request-id": "req-2",
      }),
      ids,
    );
    expect(context.actor).toEqual({ type: "user", id: ACTOR_ID });
    expect(context.organizationId).toBe(ORG_ID);
    expect(context.correlationId).toBe("req-2");
  });

  it("throws ValidationError when X-Organization-Id is missing", () => {
    expect(() => buildOrgScopedContext(request({ "x-actor-id": ACTOR_ID }), ids)).toThrow(
      ValidationError,
    );
  });
});
