import { describe, expect, it } from "vitest";

import * as tenancy from "../src/index.js";

/**
 * Compilation smoke test (E05-T01 Section 10, test 1 of 3): proves the
 * package builds end-to-end and its declared public exports actually
 * resolve at runtime — distinct from the module-registration test
 * (behavior of `createTenancyModule`) and the export-surface snapshot
 * test (the *complete* export list, intentional or not).
 */
describe("@corestack/tenancy compiles and its declared exports resolve", () => {
  it("exposes the module factory and config spec", () => {
    expect(typeof tenancy.createTenancyModule).toBe("function");
    expect(tenancy.tenancyConfigSpec.moduleName).toBe("tenancy");
  });

  it("exposes the tenancy event names", () => {
    expect(tenancy.ORGANIZATION_CREATED_EVENT).toBe("organization.created");
    expect(tenancy.ORGANIZATION_UPDATED_EVENT).toBe("organization.updated");
    expect(tenancy.ORGANIZATION_DELETED_EVENT).toBe("organization.deleted");
    expect(tenancy.MEMBER_JOINED_EVENT).toBe("member.joined");
    expect(tenancy.MEMBER_UPDATED_EVENT).toBe("member.updated");
    expect(tenancy.MEMBER_REMOVED_EVENT).toBe("member.removed");
  });

  it("exposes the Organization aggregate and its value objects (E05-T02)", () => {
    expect(typeof tenancy.Organization.create).toBe("function");
    expect(typeof tenancy.OrganizationId.from).toBe("function");
    expect(typeof tenancy.OrganizationSlug.from).toBe("function");
    expect(tenancy.OrganizationStatus.Active).toBe("ACTIVE");
    expect(typeof tenancy.isLegalOrganizationStatusTransition).toBe("function");
  });

  it("exposes the createOrganization use case (E05-T03)", () => {
    expect(typeof tenancy.createOrganization).toBe("function");
    expect(typeof tenancy.DuplicateSlugError).toBe("function");
  });

  it("exposes the Membership aggregate and its value objects (E05-T04)", () => {
    expect(typeof tenancy.Membership.create).toBe("function");
    expect(typeof tenancy.MembershipId.from).toBe("function");
    expect(typeof tenancy.UserId.from).toBe("function");
    expect(tenancy.MembershipRole.Owner).toBe("OWNER");
    expect(tenancy.MembershipStatus.Active).toBe("ACTIVE");
    expect(typeof tenancy.isLegalMembershipRoleTransition).toBe("function");
    expect(typeof tenancy.isLegalMembershipStatusTransition).toBe("function");
  });
});
