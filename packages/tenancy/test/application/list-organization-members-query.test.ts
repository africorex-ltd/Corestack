import { describe, expect, it } from "vitest";
import { InMemoryEventBus, InMemoryUnitOfWork, createContext, UuidGenerator } from "@corestack/kernel";
import { requireOrgScoped, type OrgScopedContext } from "@corestack/platform";

import { Membership } from "../../src/domain/membership.js";
import { MembershipRole } from "../../src/domain/membership-role.js";
import { MembershipStatus } from "../../src/domain/membership-status.js";
import {
  listOrganizationMembers,
  toOrganizationMemberSummary,
} from "../../src/application/list-organization-members-query.js";
import { InMemoryMembershipRepository } from "../../test-support/in-memory-membership-repository.js";

const NOW = new Date("2026-07-30T00:00:00.000Z");
const ids = new UuidGenerator();

function buildDeps() {
  const repository = new InMemoryMembershipRepository();
  const uow = new InMemoryUnitOfWork(new InMemoryEventBus());
  return { repository, uow };
}

function orgContext(organizationId: string): OrgScopedContext {
  return requireOrgScoped(
    createContext({ actor: { type: "user", id: ids.generate() }, organizationId }, ids),
  );
}

describe("listOrganizationMembers", () => {
  it("returns members sorted by joinedAt ascending, regardless of arrival order", async () => {
    const { repository, uow } = buildDeps();
    const organizationId = ids.generate();
    const context = orgContext(organizationId);

    const later = Membership.create({
      id: ids.generate(),
      organizationId,
      userId: ids.generate(),
      role: MembershipRole.Member,
      now: new Date(NOW.getTime() + 2000),
    });
    const earlier = Membership.create({
      id: ids.generate(),
      organizationId,
      userId: ids.generate(),
      role: MembershipRole.Owner,
      now: new Date(NOW.getTime() + 1000),
    });
    await repository.save({ publish: () => {} }, context, later);
    await repository.save({ publish: () => {} }, context, earlier);

    const result = await listOrganizationMembers(context, { repository, uow });

    expect(result.map((m) => m.id)).toEqual([earlier.id.value, later.id.value]);
  });

  it("includes REMOVED memberships (Section 5 does not filter by status) but never exposes removedAt", async () => {
    const { repository, uow } = buildDeps();
    const organizationId = ids.generate();
    const context = orgContext(organizationId);

    const membership = Membership.create({
      id: ids.generate(),
      organizationId,
      userId: ids.generate(),
      role: MembershipRole.Member,
      now: NOW,
    });
    membership.remove(new Date(NOW.getTime() + 1000));
    await repository.save({ publish: () => {} }, context, membership);

    const result = await listOrganizationMembers(context, { repository, uow });

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe(MembershipStatus.Removed);
    expect(result[0]).not.toHaveProperty("removedAt");
  });

  it("never returns another organization's members", async () => {
    const { repository, uow } = buildDeps();
    const orgA = ids.generate();
    const orgB = ids.generate();

    const membershipB = Membership.create({
      id: ids.generate(),
      organizationId: orgB,
      userId: ids.generate(),
      role: MembershipRole.Owner,
      now: NOW,
    });
    await repository.save({ publish: () => {} }, orgContext(orgB), membershipB);

    const result = await listOrganizationMembers(orgContext(orgA), { repository, uow });
    expect(result).toEqual([]);
  });

  it("returns an empty array for an organization with no members", async () => {
    const { repository, uow } = buildDeps();
    const result = await listOrganizationMembers(orgContext(ids.generate()), { repository, uow });
    expect(result).toEqual([]);
  });
});

describe("toOrganizationMemberSummary", () => {
  it("maps every DTO field, excluding removedAt", () => {
    const membership = Membership.create({
      id: ids.generate(),
      organizationId: ids.generate(),
      userId: ids.generate(),
      role: MembershipRole.Admin,
      now: NOW,
    });

    expect(toOrganizationMemberSummary(membership)).toEqual({
      id: membership.id.value,
      userId: membership.userId.value,
      role: MembershipRole.Admin,
      status: MembershipStatus.Active,
      joinedAt: membership.joinedAt,
    });
  });
});
