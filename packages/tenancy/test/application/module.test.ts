import { describe, expect, it } from "vitest";
import { InMemoryProcessedEventStore, type DomainEvent } from "@corestack/kernel";
import { checkModuleConformance, ORGANIZATION_PURGE_REQUESTED_EVENT } from "@corestack/platform";
import type { MigrationSet } from "@corestack/platform";

import { createTenancyModule } from "../../src/application/module.js";
import type { OrganizationRepository } from "../../src/application/organization-repository.js";
import type { MembershipRepository } from "../../src/application/membership-repository.js";
import type { InvitationRepository } from "../../src/application/invitation-repository.js";

const organizationRepository: OrganizationRepository = {
  findById: async () => null,
  listForContext: async () => [],
  existsBySlug: async () => false,
  findBySlug: async () => null,
  save: async () => undefined,
};
const membershipRepository: MembershipRepository = {
  findById: async () => null,
  listForOrganization: async () => [],
  findByUserId: async () => null,
  existsActive: async () => false,
  save: async () => undefined,
};
const invitationRepository: InvitationRepository = {
  findById: async () => null,
  listForOrganization: async () => [],
  existsPendingForEmail: async () => false,
  save: async () => undefined,
};
const emptyMigrations: MigrationSet = { module: "tenancy", migrations: [] };

function buildModule() {
  return createTenancyModule(
    {
      processedEventStore: new InMemoryProcessedEventStore(),
      migrations: emptyMigrations,
      organizationRepository,
      membershipRepository,
      invitationRepository,
    },
    { invitationExpiryHours: "72", invitationExpiryDays: "7", invitationRateLimitPerHour: "10" },
  );
}

/**
 * Module-registration test (E05-T01 Section 10, test 2 of 3): proves
 * `createTenancyModule` actually satisfies the module lifecycle contract
 * (E03-T20) at runtime, not just structurally at compile time, and that
 * the purge stub is loud rather than a silent no-op (Section 9's
 * requirement — a scaffold purge handler that quietly succeeds would let
 * the purge protocol mark an org's Tenancy data "purged" without deleting
 * anything, once real data exists).
 */
describe("createTenancyModule", () => {
  it("returns a ModuleInstance conforming to the module lifecycle contract", () => {
    expect(checkModuleConformance(buildModule())).toEqual([]);
  });

  it("reports healthy (scaffold stub — no real signals yet)", async () => {
    const health = await buildModule().health();
    expect(health).toEqual({ status: "healthy" });
  });

  it("registers exactly one purge subscription for organization.purge_requested", () => {
    const instance = buildModule();
    expect(instance.eventHandlers).toHaveLength(1);
    expect(instance.eventHandlers[0]?.consumer).toBe("tenancy:purge");
    expect(instance.eventHandlers[0]?.event).toBe(ORGANIZATION_PURGE_REQUESTED_EVENT);
  });

  it("purge handler throws instead of silently no-op-ing", async () => {
    const instance = buildModule();
    const event: DomainEvent = {
      id: "evt-1",
      name: ORGANIZATION_PURGE_REQUESTED_EVENT,
      version: 1,
      occurredAt: new Date(),
      organizationId: "org-1",
      actor: { type: "system", id: null },
      correlationId: "corr-1",
      causationId: null,
      payload: {},
    };
    await expect(instance.eventHandlers[0]?.handler(event)).rejects.toThrow(
      /tenancy purge handler is not implemented yet/,
    );
  });
});
