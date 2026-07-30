import { describe, expect, it } from "vitest";

import { InvitationRole, assertValidInvitationRole } from "../../src/domain/invitation-role.js";

describe("assertValidInvitationRole", () => {
  it.each([InvitationRole.Admin, InvitationRole.Member])("accepts %s", (role) => {
    expect(assertValidInvitationRole(role)).toBe(role);
  });

  it("rejects OWNER with a dedicated message", () => {
    expect(() => assertValidInvitationRole("OWNER")).toThrow(/cannot invite a member as OWNER/);
  });

  it.each([["lowercase admin", "admin"], ["empty string", ""], ["unknown role", "SUPERADMIN"]])(
    "rejects an unrecognized value (%s)",
    (_label, value) => {
      expect(() => assertValidInvitationRole(value)).toThrow(/invalid invitation role/);
    },
  );
});
