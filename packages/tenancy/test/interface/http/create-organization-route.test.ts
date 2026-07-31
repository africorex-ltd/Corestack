import { describe, expect, it } from "vitest";

import { handleCreateOrganization } from "../../../src/interface/http/create-organization-route.js";
import type { HttpRequest } from "../../../src/interface/http/types.js";
import { buildHttpDeps } from "./test-helpers.js";

const ACTOR_ID = "00000000-0000-7000-8000-000000000099";

function request(body: unknown, headers: Record<string, string | undefined> = {}): HttpRequest {
  return { params: {}, headers: { "x-actor-id": ACTOR_ID, ...headers }, body };
}

describe("handleCreateOrganization", () => {
  it("201s with the CreateOrganizationResult DTO on success", async () => {
    const deps = buildHttpDeps();
    const response = await handleCreateOrganization(
      request({ name: "Acme Corp", slug: "acme-corp" }),
      deps,
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ slug: "acme-corp", status: "ACTIVE" });
  });

  it("400s when the body is missing required fields", async () => {
    const deps = buildHttpDeps();
    const response = await handleCreateOrganization(request({ name: "Acme Corp" }), deps);
    expect(response.status).toBe(400);
  });

  it("400s when X-Actor-Id is missing", async () => {
    const deps = buildHttpDeps();
    const response = await handleCreateOrganization(
      { params: {}, headers: {}, body: { name: "Acme Corp", slug: "acme-corp" } },
      deps,
    );
    expect(response.status).toBe(400);
  });

  it("400s on unknown body fields (.strict())", async () => {
    const deps = buildHttpDeps();
    const response = await handleCreateOrganization(
      request({ name: "Acme Corp", slug: "acme-corp", unexpected: true }),
      deps,
    );
    expect(response.status).toBe(400);
  });

  it("409s on a duplicate slug", async () => {
    const deps = buildHttpDeps();
    const slug = "dup-slug";
    const first = await handleCreateOrganization(request({ name: "First", slug }), deps);
    expect(first.status).toBe(201);

    const second = await handleCreateOrganization(request({ name: "Second", slug }), deps);
    expect(second.status).toBe(409);
  });
});
