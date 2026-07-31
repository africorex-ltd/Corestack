import { describe, expect, it } from "vitest";
import { createContext } from "@corestack/kernel";
import { requireOrgScoped } from "@corestack/platform";

import { Organization } from "../../../src/domain/organization.js";
import { Invitation } from "../../../src/domain/invitation.js";
import { InvitationRole } from "../../../src/domain/invitation-role.js";
import { handleListPendingInvitations } from "../../../src/interface/http/list-pending-invitations-route.js";
import type { HttpRequest, TenancyHttpDeps } from "../../../src/interface/http/types.js";
import { buildHttpDeps, REFERENCE_DATE } from "./test-helpers.js";

const NO_OP_TX = { publish: () => {} };
const EXPIRES_AT = new Date(REFERENCE_DATE.getTime() + 7 * 24 * 60 * 60 * 1000);

async function seedOrganizationWithPendingInvitation(
  deps: TenancyHttpDeps,
  slug: string,
  email: string,
): Promise<{ organizationId: string; invitationId: string }> {
  const actorId = deps.ids.generate();
  const organization = Organization.create({
    id: deps.ids.generate(),
    name: "Acme Corp",
    slug,
    now: REFERENCE_DATE,
  });
  const plainContext = createContext({ actor: { type: "user", id: actorId } }, deps.ids);
  await deps.organizationRepository.save(NO_OP_TX, plainContext, organization);

  const invitation = Invitation.create({
    id: deps.ids.generate(),
    organizationId: organization.id.value,
    email,
    role: InvitationRole.Member,
    invitedBy: actorId,
    now: REFERENCE_DATE,
    expiresAt: EXPIRES_AT,
  });
  const orgContext = requireOrgScoped(
    createContext({ actor: { type: "user", id: actorId }, organizationId: organization.id.value }, deps.ids),
  );
  await deps.invitationRepository.save(NO_OP_TX, orgContext, invitation);

  return { organizationId: organization.id.value, invitationId: invitation.id.value };
}

function request(targetOrgId: string, callerOrgId: string): HttpRequest {
  return {
    params: { id: targetOrgId },
    headers: { "x-actor-id": "00000000-0000-7000-8000-000000000090", "x-organization-id": callerOrgId },
  };
}

describe("handleListPendingInvitations", () => {
  it("200s with the pending invitation list when the caller's own org matches the path", async () => {
    const deps = buildHttpDeps();
    const { organizationId, invitationId } = await seedOrganizationWithPendingInvitation(
      deps,
      "acme-a",
      "invitee@example.com",
    );

    const response = await handleListPendingInvitations(request(organizationId, organizationId), deps);
    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: invitationId })]);
  });

  // Cross-tenant invisibility is not representable against the in-memory
  // repository for the same reason `list-organization-members-route.test.ts`
  // documents — see that file's comment. Proven exclusively in the
  // real-Postgres integration suite.

  it("400s for a malformed path id", async () => {
    const deps = buildHttpDeps();
    const { organizationId } = await seedOrganizationWithPendingInvitation(
      deps,
      "acme-a",
      "invitee@example.com",
    );

    const response = await handleListPendingInvitations(request("not-a-uuid", organizationId), deps);
    expect(response.status).toBe(400);
  });
});
