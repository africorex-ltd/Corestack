import { describe, expect, it } from "vitest";

import {
  MembershipStatus,
  isLegalMembershipStatusTransition,
} from "../../src/domain/membership-status.js";

describe("isLegalMembershipStatusTransition", () => {
  it.each([
    [MembershipStatus.Active, MembershipStatus.Suspended],
    [MembershipStatus.Suspended, MembershipStatus.Active],
    [MembershipStatus.Active, MembershipStatus.Removed],
    [MembershipStatus.Suspended, MembershipStatus.Removed],
  ])("allows %s -> %s", (from, to) => {
    expect(isLegalMembershipStatusTransition(from, to)).toBe(true);
  });

  it.each([
    [MembershipStatus.Active, MembershipStatus.Active],
    [MembershipStatus.Suspended, MembershipStatus.Suspended],
    [MembershipStatus.Removed, MembershipStatus.Removed],
    [MembershipStatus.Removed, MembershipStatus.Active],
    [MembershipStatus.Removed, MembershipStatus.Suspended],
  ])("forbids %s -> %s", (from, to) => {
    expect(isLegalMembershipStatusTransition(from, to)).toBe(false);
  });

  it("REMOVED has no legal outgoing transitions at all (terminal)", () => {
    for (const to of Object.values(MembershipStatus)) {
      expect(isLegalMembershipStatusTransition(MembershipStatus.Removed, to)).toBe(false);
    }
  });
});
