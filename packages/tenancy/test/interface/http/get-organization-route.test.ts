import { describe, expect, it } from "vitest";
import { createContext } from "@corestack/kernel";

import { Organization } from "../../../src/domain/organization.js";
import { handleGetOrganization } from "../../../src/interface/http/get-organization-route.js";
import type { HttpRequest, TenancyHttpDeps } from "../../../src/interface/http/types.js";
import { buildHttpDeps, REFERENCE_DATE } from "./test-helpers.js";

const ACTOR_ID = "00000000-0000-7000-8000-000000000050";
const NO_OP_TX = { publish: () => {} };

async function seedOrganization(deps: TenancyHttpDeps, slug: string): Promise<string> {
  const organization = Organization.create({
    id: deps.ids.generate(),
    name: "Acme Corp",
    slug,
    now: REFERENCE_DATE,
  });
  const plainContext = createContext({ actor: { type: "user", id: ACTOR_ID } }, deps.ids);
  await deps.organizationRepository.save(NO_OP_TX, plainContext, organization);
  return organization.id.value;
}

function request(targetOrgId: string, callerOrgId: string | undefined): HttpRequest {
  return {
    params: { id: targetOrgId },
    headers: {
      "x-actor-id": ACTOR_ID,
      ...(callerOrgId !== undefined ? { "x-organization-id": callerOrgId } : {}),
    },
  };
}

describe("handleGetOrganization", () => {
  it("200s with the OrganizationSummary DTO when the caller's own org matches the path", async () => {
    const deps = buildHttpDeps();
    const orgId = await seedOrganization(deps, "acme-a");

    const response = await handleGetOrganization(request(orgId, orgId), deps);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: orgId, slug: "acme-a", status: "ACTIVE" });
  });

  // Cross-tenant invisibility (Section 8: 404, never 403, when the path
  // names a different organization than the caller's own scope) is
  // **not** representable against the in-memory repository:
  // `InMemoryOrganizationRepository.findById` ignores `context` entirely
  // (it has no RLS to emulate — matching E05-T11's own established
  // limitation for this exact repository). That proof lives exclusively
  // in the real-Postgres integration suite
  // (test/integration/tenancy-postgres.postgres.test.ts), the same place
  // E05-T11/T12 proved the identical property for the repository/query
  // layers this route is built on.

  it("404s for a non-existent organization id", async () => {
    const deps = buildHttpDeps();
    const orgId = await seedOrganization(deps, "acme-a");
    const missingId = "00000000-0000-7000-8000-000000000099";

    const response = await handleGetOrganization(request(missingId, orgId), deps);
    expect(response.status).toBe(404);
  });

  it("400s for a malformed path id", async () => {
    const deps = buildHttpDeps();
    const orgId = await seedOrganization(deps, "acme-a");

    const response = await handleGetOrganization(request("not-a-uuid", orgId), deps);
    expect(response.status).toBe(400);
  });

  it("400s when X-Organization-Id is missing", async () => {
    const deps = buildHttpDeps();
    const orgId = await seedOrganization(deps, "acme-a");

    const response = await handleGetOrganization(request(orgId, undefined), deps);
    expect(response.status).toBe(400);
  });
});
