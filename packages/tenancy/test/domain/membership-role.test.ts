import { describe, expect, it } from "vitest";

import {
  MembershipRole,
  isLegalMembershipRoleTransition,
} from "../../src/domain/membership-role.js";

describe("isLegalMembershipRoleTransition", () => {
  it.each([
    [MembershipRole.Member, MembershipRole.Admin],
    [MembershipRole.Admin, MembershipRole.Member],
  ])("allows %s -> %s", (from, to) => {
    expect(isLegalMembershipRoleTransition(from, to)).toBe(true);
  });

  it.each([
    [MembershipRole.Member, MembershipRole.Member],
    [MembershipRole.Admin, MembershipRole.Admin],
    [MembershipRole.Owner, MembershipRole.Owner],
    [MembershipRole.Owner, MembershipRole.Admin],
    [MembershipRole.Owner, MembershipRole.Member],
  ])("forbids %s -> %s", (from, to) => {
    expect(isLegalMembershipRoleTransition(from, to)).toBe(false);
  });

  it("OWNER has no legal outgoing role transitions through this aggregate", () => {
    for (const to of Object.values(MembershipRole)) {
      expect(isLegalMembershipRoleTransition(MembershipRole.Owner, to)).toBe(false);
    }
  });
});
