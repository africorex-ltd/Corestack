import { describe, expect, it } from "vitest";
import { createContext } from "@corestack/kernel";
import { requireOrgScoped } from "@corestack/platform";

import { Organization } from "../../../src/domain/organization.js";
import { Membership } from "../../../src/domain/membership.js";
import { MembershipRole } from "../../../src/domain/membership-role.js";
import { handleInviteMember } from "../../../src/interface/http/invite-member-route.js";
import type { HttpRequest, TenancyHttpDeps } from "../../../src/interface/http/types.js";
import { buildHttpDeps, REFERENCE_DATE } from "./test-helpers.js";

const OWNER_ID = "00000000-0000-7000-8000-000000000050";
const NO_OP_TX = { publish: () => {} };

async function seedActiveOrgWithOwner(deps: TenancyHttpDeps): Promise<string> {
  const organization = Organization.create({
    id: deps.ids.generate(),
    name: "Acme Corp",
    slug: `acme-${Math.random().toString(36).slice(2, 8)}`,
    now: REFERENCE_DATE,
  });
  const plainContext = createContext({ actor: { type: "user", id: OWNER_ID } }, deps.ids);
  await deps.organizationRepository.save(NO_OP_TX, plainContext, organization);

  const ownerMembership = Membership.create({
    id: deps.ids.generate(),
    organizationId: organization.id.value,
    userId: OWNER_ID,
    role: MembershipRole.Owner,
    now: REFERENCE_DATE,
  });
  const orgContext = requireOrgScoped(
    createContext(
      { actor: { type: "user", id: OWNER_ID }, organizationId: organization.id.value },
      deps.ids,
    ),
  );
  await deps.membershipRepository.save(NO_OP_TX, orgContext, ownerMembership);

  return organization.id.value;
}

function request(
  organizationId: string,
  body: unknown,
  headers: Record<string, string | undefined> = {},
): HttpRequest {
  return {
    params: { id: organizationId },
    headers: { "x-actor-id": OWNER_ID, "x-organization-id": organizationId, ...headers },
    body,
  };
}

describe("handleInviteMember", () => {
  it("201s with the InviteMemberResult DTO on success", async () => {
    const deps = buildHttpDeps();
    const organizationId = await seedActiveOrgWithOwner(deps);

    const response = await handleInviteMember(
      request(organizationId, { email: "invitee@example.com", role: "MEMBER" }),
      deps,
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ email: "invitee@example.com", role: "MEMBER" });
  });

  it("400s for an invalid email", async () => {
    const deps = buildHttpDeps();
    const organizationId = await seedActiveOrgWithOwner(deps);

    const response = await handleInviteMember(
      request(organizationId, { email: "not-an-email", role: "MEMBER" }),
      deps,
    );
    expect(response.status).toBe(400);
  });

  it("400s for an OWNER role request (rejected by the interface layer's role enum, one layer before CannotInviteOwnerError)", async () => {
    const deps = buildHttpDeps();
    const organizationId = await seedActiveOrgWithOwner(deps);

    const response = await handleInviteMember(
      request(organizationId, { email: "invitee@example.com", role: "OWNER" }),
      deps,
    );
    expect(response.status).toBe(400);
  });

  it("403s when the path organizationId does not match X-Organization-Id", async () => {
    const deps = buildHttpDeps();
    const organizationId = await seedActiveOrgWithOwner(deps);
    const otherOrgId = "00000000-0000-7000-8000-000000000077";

    const response = await handleInviteMember(
      request(organizationId, { email: "invitee@example.com", role: "MEMBER" }, {
        "x-organization-id": otherOrgId,
      }),
      deps,
    );
    expect(response.status).toBe(403);
  });

  it("403s when the actor has no membership in the organization (InviterNotAuthorizedError)", async () => {
    const deps = buildHttpDeps();
    const organizationId = await seedActiveOrgWithOwner(deps);
    const strangerId = "00000000-0000-7000-8000-000000000066";

    const response = await handleInviteMember(
      request(organizationId, { email: "invitee@example.com", role: "MEMBER" }, {
        "x-actor-id": strangerId,
      }),
      deps,
    );
    expect(response.status).toBe(403);
  });

  it("409s on a duplicate pending invitation", async () => {
    const deps = buildHttpDeps();
    const organizationId = await seedActiveOrgWithOwner(deps);
    const email = "invitee@example.com";

    const first = await handleInviteMember(request(organizationId, { email, role: "MEMBER" }), deps);
    expect(first.status).toBe(201);

    const second = await handleInviteMember(request(organizationId, { email, role: "MEMBER" }), deps);
    expect(second.status).toBe(409);
  });
});
