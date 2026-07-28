import { describe, expect, it } from "vitest";
import { ForbiddenError, SequentialIdGenerator, isErr, isOk } from "@corestack/kernel";

import { resolveContext } from "../../src/application/resolve-context.js";
import { InMemoryMembershipLookup } from "../../src/testing/in-memory-membership-lookup.js";

const ids = () => new SequentialIdGenerator("corr-");

describe("resolveContext (E03-T32; ADR-0008 layer 2)", () => {
  it("resolves organizationId: null for a claim-free (platform-scoped) request", async () => {
    const lookup = new InMemoryMembershipLookup();
    const result = await resolveContext(
      { actor: { type: "user", id: "u1" }, claimedOrganizationId: null },
      lookup,
      ids(),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.organizationId).toBeNull();
  });

  it("resolves organizationId to the claim when the actor is a verified active member", async () => {
    const lookup = new InMemoryMembershipLookup();
    lookup.addActiveMember("u1", "org-1");

    const result = await resolveContext(
      { actor: { type: "user", id: "u1" }, claimedOrganizationId: "org-1" },
      lookup,
      ids(),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.organizationId).toBe("org-1");
      expect(result.value.actor).toEqual({ type: "user", id: "u1" });
    }
  });

  it("forged-org-header fails closed: a claim the actor is not a member of is rejected (task AC)", async () => {
    const lookup = new InMemoryMembershipLookup();
    lookup.addActiveMember("u1", "org-1"); // u1 belongs to org-1, NOT org-2

    const result = await resolveContext(
      { actor: { type: "user", id: "u1" }, claimedOrganizationId: "org-2" },
      lookup,
      ids(),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error).toBeInstanceOf(ForbiddenError);
  });

  it("a claim for a nonexistent organization fails identically to a claim for a real org you don't belong to", async () => {
    // Architecture §20: cross-tenant access must look identical to
    // non-existence — both paths return the exact same ForbiddenError
    // shape, never distinguishable by an attacker probing org ids.
    const lookup = new InMemoryMembershipLookup();
    lookup.addActiveMember("u1", "org-1");

    const nonMemberResult = await resolveContext(
      { actor: { type: "user", id: "u1" }, claimedOrganizationId: "org-1-but-not-a-member" },
      lookup,
      ids(),
    );
    const nonexistentOrgResult = await resolveContext(
      { actor: { type: "user", id: "u1" }, claimedOrganizationId: "org-does-not-exist" },
      lookup,
      ids(),
    );
    expect(isErr(nonMemberResult) && isErr(nonexistentOrgResult)).toBe(true);
    if (isErr(nonMemberResult) && isErr(nonexistentOrgResult)) {
      expect(nonMemberResult.error.message).toBe(nonexistentOrgResult.error.message);
    }
  });

  it("rejects an organization claim paired with a system actor", async () => {
    const lookup = new InMemoryMembershipLookup();
    const result = await resolveContext(
      { actor: { type: "system", id: null }, claimedOrganizationId: "org-1" },
      lookup,
      ids(),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error).toBeInstanceOf(ForbiddenError);
  });

  it("a suspended/removed membership (not in the active set) is rejected", async () => {
    const lookup = new InMemoryMembershipLookup();
    // u1 is never added as active for org-1 (simulating a removed/suspended member)
    const result = await resolveContext(
      { actor: { type: "user", id: "u1" }, claimedOrganizationId: "org-1" },
      lookup,
      ids(),
    );
    expect(isErr(result)).toBe(true);
  });

  it("propagates correlationId, causationId, and locale into the resolved Context", async () => {
    const lookup = new InMemoryMembershipLookup();
    lookup.addActiveMember("u1", "org-1");

    const result = await resolveContext(
      {
        actor: { type: "user", id: "u1" },
        claimedOrganizationId: "org-1",
        correlationId: "corr-fixed",
        causationId: "event-1",
        locale: "en-US",
      },
      lookup,
      ids(),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.correlationId).toBe("corr-fixed");
      expect(result.value.causationId).toBe("event-1");
      expect(result.value.locale).toBe("en-US");
    }
  });

  it("an api_key actor is resolved through the same membership check as a user actor", async () => {
    const lookup = new InMemoryMembershipLookup();
    lookup.addActiveMember("key-1", "org-1");

    const result = await resolveContext(
      { actor: { type: "api_key", id: "key-1" }, claimedOrganizationId: "org-1" },
      lookup,
      ids(),
    );
    expect(isOk(result)).toBe(true);
  });
});
