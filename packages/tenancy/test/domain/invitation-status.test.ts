import { describe, expect, it } from "vitest";

import {
  InvitationStatus,
  isLegalInvitationStatusTransition,
} from "../../src/domain/invitation-status.js";

describe("isLegalInvitationStatusTransition", () => {
  it.each([
    [InvitationStatus.Pending, InvitationStatus.Accepted],
    [InvitationStatus.Pending, InvitationStatus.Revoked],
    [InvitationStatus.Pending, InvitationStatus.Expired],
  ])("allows %s -> %s", (from, to) => {
    expect(isLegalInvitationStatusTransition(from, to)).toBe(true);
  });

  it.each([
    [InvitationStatus.Pending, InvitationStatus.Pending],
    [InvitationStatus.Accepted, InvitationStatus.Accepted],
    [InvitationStatus.Accepted, InvitationStatus.Revoked],
    [InvitationStatus.Accepted, InvitationStatus.Expired],
    [InvitationStatus.Accepted, InvitationStatus.Pending],
    [InvitationStatus.Revoked, InvitationStatus.Revoked],
    [InvitationStatus.Revoked, InvitationStatus.Accepted],
    [InvitationStatus.Revoked, InvitationStatus.Expired],
    [InvitationStatus.Revoked, InvitationStatus.Pending],
    [InvitationStatus.Expired, InvitationStatus.Expired],
    [InvitationStatus.Expired, InvitationStatus.Accepted],
    [InvitationStatus.Expired, InvitationStatus.Revoked],
    [InvitationStatus.Expired, InvitationStatus.Pending],
  ])("forbids %s -> %s", (from, to) => {
    expect(isLegalInvitationStatusTransition(from, to)).toBe(false);
  });

  it("ACCEPTED, REVOKED, and EXPIRED each have no legal outgoing transitions at all (terminal)", () => {
    for (const from of [
      InvitationStatus.Accepted,
      InvitationStatus.Revoked,
      InvitationStatus.Expired,
    ]) {
      for (const to of Object.values(InvitationStatus)) {
        expect(isLegalInvitationStatusTransition(from, to)).toBe(false);
      }
    }
  });
});
