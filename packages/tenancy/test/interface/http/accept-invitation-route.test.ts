import { describe, expect, it } from "vitest";
import { createContext, type FixedClock } from "@corestack/kernel";
import { requireOrgScoped } from "@corestack/platform";

import { Organization } from "../../../src/domain/organization.js";
import { Invitation } from "../../../src/domain/invitation.js";
import { InvitationRole } from "../../../src/domain/invitation-role.js";
import { handleAcceptInvitation } from "../../../src/interface/http/accept-invitation-route.js";
import type { HttpRequest, TenancyHttpDeps } from "../../../src/interface/http/types.js";
import { buildHttpDeps, REFERENCE_DATE } from "./test-helpers.js";

const INVITER_ID = "00000000-0000-7000-8000-000000000050";
const ACCEPTOR_ID = "00000000-0000-7000-8000-000000000060";
const NO_OP_TX = { publish: () => {} };
const EXPIRES_AT = new Date(REFERENCE_DATE.getTime() + 7 * 24 * 60 * 60 * 1000);

async function seedOrgAndInvitation(
  deps: TenancyHttpDeps,
  overrides: { email?: string; now?: Date; expiresAt?: Date } = {},
): Promise<{ organizationId: string; invitationId: string }> {
  const organization = Organization.create({
    id: deps.ids.generate(),
    name: "Acme Corp",
    slug: `acme-${Math.random().toString(36).slice(2, 8)}`,
    now: REFERENCE_DATE,
  });
  const plainContext = createContext({ actor: { type: "user", id: INVITER_ID } }, deps.ids);
  await deps.organizationRepository.save(NO_OP_TX, plainContext, organization);

  const invitation = Invitation.create({
    id: deps.ids.generate(),
    organizationId: organization.id.value,
    email: overrides.email ?? "invitee@example.com",
    role: InvitationRole.Member,
    invitedBy: INVITER_ID,
    now: overrides.now ?? REFERENCE_DATE,
    expiresAt: overrides.expiresAt ?? EXPIRES_AT,
  });
  const orgContext = requireOrgScoped(
    createContext(
      { actor: { type: "user", id: INVITER_ID }, organizationId: organization.id.value },
      deps.ids,
    ),
  );
  await deps.invitationRepository.save(NO_OP_TX, orgContext, invitation);

  return { organizationId: organization.id.value, invitationId: invitation.id.value };
}

function request(
  organizationId: string,
  invitationId: string,
  body: unknown,
  headers: Record<string, string | undefined> = {},
): HttpRequest {
  return {
    params: { id: invitationId },
    headers: {
      "x-actor-id": ACCEPTOR_ID,
      "x-organization-id": organizationId,
      ...headers,
    },
    body,
  };
}

describe("handleAcceptInvitation", () => {
  it("200s with the AcceptInvitationResult DTO on success", async () => {
    const deps = buildHttpDeps();
    const { organizationId, invitationId } = await seedOrgAndInvitation(deps);

    const response = await handleAcceptInvitation(
      request(organizationId, invitationId, { email: "invitee@example.com" }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ userId: ACCEPTOR_ID, role: "MEMBER" });
  });

  it("400s for an invalid email", async () => {
    const deps = buildHttpDeps();
    const { organizationId, invitationId } = await seedOrgAndInvitation(deps);

    const response = await handleAcceptInvitation(
      request(organizationId, invitationId, { email: "not-an-email" }),
      deps,
    );
    expect(response.status).toBe(400);
  });

  it("403s when the claimed email does not match the invitation's recipient", async () => {
    const deps = buildHttpDeps();
    const { organizationId, invitationId } = await seedOrgAndInvitation(deps);

    const response = await handleAcceptInvitation(
      request(organizationId, invitationId, { email: "someone-else@example.com" }),
      deps,
    );
    expect(response.status).toBe(403);
  });

  it("404s for a non-existent invitation id", async () => {
    const deps = buildHttpDeps();
    const { organizationId } = await seedOrgAndInvitation(deps);
    const missingId = "00000000-0000-7000-8000-000000000099";

    const response = await handleAcceptInvitation(
      request(organizationId, missingId, { email: "invitee@example.com" }),
      deps,
    );
    expect(response.status).toBe(404);
  });

  it("409s for an already-accepted invitation", async () => {
    const deps = buildHttpDeps();
    const { organizationId, invitationId } = await seedOrgAndInvitation(deps);

    const first = await handleAcceptInvitation(
      request(organizationId, invitationId, { email: "invitee@example.com" }),
      deps,
    );
    expect(first.status).toBe(200);

    const second = await handleAcceptInvitation(
      request(organizationId, invitationId, { email: "invitee@example.com" }, {
        "x-actor-id": "00000000-0000-7000-8000-000000000070",
      }),
      deps,
    );
    expect(second.status).toBe(409);
  });

  it("409s for an expired invitation", async () => {
    const deps = buildHttpDeps();
    const pastExpiry = new Date(REFERENCE_DATE.getTime() + 1000);
    const { organizationId, invitationId } = await seedOrgAndInvitation(deps, {
      now: REFERENCE_DATE,
      expiresAt: pastExpiry,
    });

    // The FixedClock in buildHttpDeps() is set to REFERENCE_DATE, before
    // pastExpiry — advance it so acceptance happens after expiry.
    (deps.clock as FixedClock).set(new Date(pastExpiry.getTime() + 1000));

    const response = await handleAcceptInvitation(
      request(organizationId, invitationId, { email: "invitee@example.com" }),
      deps,
    );
    expect(response.status).toBe(409);
  });
});
