import { describe, expect, it } from "vitest";
import {
  InMemoryEventBus,
  InMemoryUnitOfWork,
  createContext,
  UuidGenerator,
} from "@corestack/kernel";
import { requireOrgScoped } from "@corestack/platform";

import { Organization } from "../../src/domain/organization.js";
import { OrganizationStatus } from "../../src/domain/organization-status.js";
import { getOrganization, toOrganizationSummary } from "../../src/application/get-organization-query.js";
import { InMemoryOrganizationRepository } from "../../test-support/in-memory-organization-repository.js";

const NOW = new Date("2026-07-30T00:00:00.000Z");
const ids = new UuidGenerator();

function buildDeps() {
  const repository = new InMemoryOrganizationRepository();
  const uow = new InMemoryUnitOfWork(new InMemoryEventBus());
  return { repository, uow };
}

describe("getOrganization", () => {
  it("returns the DTO shape from Section 4 — id, slug, name, status, createdAt, updatedAt", async () => {
    const { repository, uow } = buildDeps();
    const organization = Organization.create({
      id: ids.generate(),
      name: "Acme Corp",
      slug: "acme-corp",
      now: NOW,
    });
    await repository.save(
      { publish: () => {} },
      createContext({ actor: { type: "user", id: ids.generate() } }, ids),
      organization,
    );

    const context = requireOrgScoped(
      createContext(
        { actor: { type: "user", id: ids.generate() }, organizationId: organization.id.value },
        ids,
      ),
    );

    const result = await getOrganization(context, organization.id.value, { repository, uow });

    expect(result).toEqual({
      id: organization.id.value,
      slug: "acme-corp",
      name: "Acme Corp",
      status: OrganizationStatus.Active,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    });
  });

  it("does not expose deletedAt, unlike the aggregate itself", async () => {
    const { repository, uow } = buildDeps();
    const organization = Organization.create({
      id: ids.generate(),
      name: "Acme Corp",
      slug: "acme-corp-2",
      now: NOW,
    });
    organization.delete(new Date(NOW.getTime() + 1000));
    await repository.save(
      { publish: () => {} },
      createContext({ actor: { type: "user", id: ids.generate() } }, ids),
      organization,
    );

    const context = requireOrgScoped(
      createContext(
        { actor: { type: "user", id: ids.generate() }, organizationId: organization.id.value },
        ids,
      ),
    );

    const result = await getOrganization(context, organization.id.value, { repository, uow });
    expect(result?.status).toBe(OrganizationStatus.Deleted);
    expect(result).not.toHaveProperty("deletedAt");
  });

  it("returns null when the organization does not exist (RLS-invisible and genuinely-missing are indistinguishable, by design)", async () => {
    const { repository, uow } = buildDeps();
    const context = requireOrgScoped(
      createContext(
        { actor: { type: "user", id: ids.generate() }, organizationId: ids.generate() },
        ids,
      ),
    );

    const result = await getOrganization(context, ids.generate(), { repository, uow });
    expect(result).toBeNull();
  });
});

describe("toOrganizationSummary", () => {
  it("maps every DTO field from the aggregate's own getters", () => {
    const organization = Organization.create({
      id: ids.generate(),
      name: "Beta Inc",
      slug: "beta-inc",
      now: NOW,
    });

    expect(toOrganizationSummary(organization)).toEqual({
      id: organization.id.value,
      slug: organization.slug.value,
      name: organization.name,
      status: organization.status,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    });
  });
});
