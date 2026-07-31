import { describe, expect, it } from "vitest";
import { createContext } from "@corestack/kernel";
import { requireOrgScoped } from "@corestack/platform";

import { Organization } from "../../../src/domain/organization.js";
import { Membership } from "../../../src/domain/membership.js";
import { MembershipRole } from "../../../src/domain/membership-role.js";
import { handleListOrganizationMembers } from "../../../src/interface/http/list-organization-members-route.js";
import type { HttpRequest, TenancyHttpDeps } from "../../../src/interface/http/types.js";
import { buildHttpDeps, REFERENCE_DATE } from "./test-helpers.js";

const NO_OP_TX = { publish: () => {} };

async function seedOrganizationWithMember(
  deps: TenancyHttpDeps,
  slug: string,
): Promise<{ organizationId: string; memberId: string; userId: string }> {
  const actorId = deps.ids.generate();
  const organization = Organization.create({
    id: deps.ids.generate(),
    name: "Acme Corp",
    slug,
    now: REFERENCE_DATE,
  });
  const plainContext = createContext({ actor: { type: "user", id: actorId } }, deps.ids);
  await deps.organizationRepository.save(NO_OP_TX, plainContext, organization);

  const userId = deps.ids.generate();
  const membership = Membership.create({
    id: deps.ids.generate(),
    organizationId: organization.id.value,
    userId,
    role: MembershipRole.Owner,
    now: REFERENCE_DATE,
  });
  const orgContext = requireOrgScoped(
    createContext({ actor: { type: "user", id: actorId }, organizationId: organization.id.value }, deps.ids),
  );
  await deps.membershipRepository.save(NO_OP_TX, orgContext, membership);

  return { organizationId: organization.id.value, memberId: membership.id.value, userId };
}

function request(targetOrgId: string, callerOrgId: string): HttpRequest {
  return {
    params: { id: targetOrgId },
    headers: { "x-actor-id": "00000000-0000-7000-8000-000000000090", "x-organization-id": callerOrgId },
  };
}

describe("handleListOrganizationMembers", () => {
  it("200s with the member list when the caller's own org matches the path", async () => {
    const deps = buildHttpDeps();
    const { organizationId, memberId } = await seedOrganizationWithMember(deps, "acme-a");

    const response = await handleListOrganizationMembers(request(organizationId, organizationId), deps);
    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: memberId })]);
  });

  // Cross-tenant invisibility (Section 8: 404, never a silent wrong-org
  // list, when the path names a different organization than the
  // caller's own scope) is **not** representable against the in-memory
  // repository: the `getOrganization` pre-check this handler relies on
  // (see this route's own doc comment) calls
  // `InMemoryOrganizationRepository.findById`, which ignores `context`
  // entirely — it has no RLS to emulate. That proof lives exclusively in
  // the real-Postgres integration suite
  // (test/integration/tenancy-postgres.postgres.test.ts).

  it("400s for a malformed path id", async () => {
    const deps = buildHttpDeps();
    const { organizationId } = await seedOrganizationWithMember(deps, "acme-a");

    const response = await handleListOrganizationMembers(
      request("not-a-uuid", organizationId),
      deps,
    );
    expect(response.status).toBe(400);
  });
});
