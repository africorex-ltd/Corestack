import { describe, expect, it } from "vitest";

import {
  OrganizationStatus,
  isLegalOrganizationStatusTransition,
} from "../../src/domain/organization-status.js";

describe("isLegalOrganizationStatusTransition", () => {
  it.each([
    [OrganizationStatus.Active, OrganizationStatus.Suspended],
    [OrganizationStatus.Suspended, OrganizationStatus.Active],
    [OrganizationStatus.Active, OrganizationStatus.Deleted],
    [OrganizationStatus.Suspended, OrganizationStatus.Deleted],
  ])("allows %s -> %s", (from, to) => {
    expect(isLegalOrganizationStatusTransition(from, to)).toBe(true);
  });

  it.each([
    [OrganizationStatus.Active, OrganizationStatus.Active],
    [OrganizationStatus.Suspended, OrganizationStatus.Suspended],
    [OrganizationStatus.Deleted, OrganizationStatus.Deleted],
    [OrganizationStatus.Deleted, OrganizationStatus.Active],
    [OrganizationStatus.Deleted, OrganizationStatus.Suspended],
  ])("forbids %s -> %s", (from, to) => {
    expect(isLegalOrganizationStatusTransition(from, to)).toBe(false);
  });

  it("DELETED has no legal outgoing transitions at all (terminal)", () => {
    for (const to of Object.values(OrganizationStatus)) {
      expect(isLegalOrganizationStatusTransition(OrganizationStatus.Deleted, to)).toBe(false);
    }
  });
});
