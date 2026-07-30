import { describe, expect, it } from "vitest";

import { Invitation } from "../../src/domain/invitation.js";
import { InvitationRole } from "../../src/domain/invitation-role.js";
import { InvitationStatus } from "../../src/domain/invitation-status.js";

const ID = "018f5a3e-7b2c-7000-8000-000000000001";
const ORG_ID = "018f5a3e-7b2c-7000-8000-000000000002";
const INVITED_BY = "018f5a3e-7b2c-7000-8000-000000000003";
const NOW = new Date("2026-07-30T00:00:00.000Z");
const LATER = new Date("2026-07-30T01:00:00.000Z");
const EARLIER = new Date("2026-07-29T23:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-06T00:00:00.000Z");

function createInvitation(
  overrides: Partial<{
    id: string;
    organizationId: string;
    email: string;
    role: string;
    invitedBy: string;
    now: Date;
    expiresAt: Date;
  }> = {},
) {
  return Invitation.create({
    id: overrides.id ?? ID,
    organizationId: overrides.organizationId ?? ORG_ID,
    email: overrides.email ?? "invitee@example.com",
    role: overrides.role ?? InvitationRole.Member,
    invitedBy: overrides.invitedBy ?? INVITED_BY,
    now: overrides.now ?? NOW,
    expiresAt: overrides.expiresAt ?? EXPIRES_AT,
  });
}

describe("Invitation.create", () => {
  it("creates a PENDING invitation with the given fields", () => {
    const invitation = createInvitation();
    expect(invitation.id.value).toBe(ID);
    expect(invitation.organizationId.value).toBe(ORG_ID);
    expect(invitation.email.value).toBe("invitee@example.com");
    expect(invitation.role).toBe(InvitationRole.Member);
    expect(invitation.invitedBy.value).toBe(INVITED_BY);
    expect(invitation.status).toBe(InvitationStatus.Pending);
    expect(invitation.respondedAt).toBeNull();
  });

  it("sets createdAt and expiresAt to the given values", () => {
    const invitation = createInvitation({ now: NOW, expiresAt: EXPIRES_AT });
    expect(invitation.createdAt.getTime()).toBe(NOW.getTime());
    expect(invitation.expiresAt.getTime()).toBe(EXPIRES_AT.getTime());
  });

  it("can be created at ADMIN role", () => {
    const invitation = createInvitation({ role: InvitationRole.Admin });
    expect(invitation.role).toBe(InvitationRole.Admin);
  });

  it("normalizes email casing and surrounding whitespace", () => {
    const invitation = createInvitation({ email: "  Invitee@Example.COM  " });
    expect(invitation.email.value).toBe("invitee@example.com");
  });

  it("emits exactly one InvitationCreated event", () => {
    const invitation = createInvitation({ now: NOW, expiresAt: EXPIRES_AT });
    const events = invitation.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "InvitationCreated",
      invitationId: ID,
      organizationId: ORG_ID,
      occurredAt: NOW,
      email: "invitee@example.com",
      role: InvitationRole.Member,
      invitedBy: INVITED_BY,
      expiresAt: EXPIRES_AT,
    });
  });

  it("rejects an invalid invitation id", () => {
    expect(() => createInvitation({ id: "not-a-uuid" })).toThrow(/invalid invitation id/);
  });

  it("rejects an invalid organization id", () => {
    expect(() => createInvitation({ organizationId: "not-a-uuid" })).toThrow(
      /invalid organization id/,
    );
  });

  it("rejects an invalid invitedBy user id", () => {
    expect(() => createInvitation({ invitedBy: "not-a-uuid" })).toThrow(/invalid user id/);
  });

  it.each([
    ["missing @", "invitee.example.com"],
    ["missing domain dot", "invitee@examplecom"],
    ["contains whitespace", "invi tee@example.com"],
    ["empty string", ""],
  ])("rejects an invalid email (%s)", (_label, email) => {
    expect(() => createInvitation({ email })).toThrow(/invalid email/);
  });

  it("rejects OWNER as a role, with a dedicated message", () => {
    expect(() => createInvitation({ role: "OWNER" })).toThrow(
      /cannot invite a member as OWNER/,
    );
  });

  it("rejects an unrecognized role", () => {
    expect(() => createInvitation({ role: "SUPERADMIN" })).toThrow(/invalid invitation role/);
  });

  it("rejects an expiresAt equal to now (not strictly in the future)", () => {
    expect(() => createInvitation({ now: NOW, expiresAt: NOW })).toThrow(
      /expiresAt must be strictly after now/,
    );
  });

  it("rejects an expiresAt in the past", () => {
    expect(() => createInvitation({ now: NOW, expiresAt: EARLIER })).toThrow(
      /expiresAt must be strictly after now/,
    );
  });
});

describe("Invitation#accept", () => {
  it("PENDING -> ACCEPTED, sets respondedAt, emits InvitationAccepted", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.clearDomainEvents();
    invitation.accept(LATER);
    expect(invitation.status).toBe(InvitationStatus.Accepted);
    expect(invitation.respondedAt?.getTime()).toBe(LATER.getTime());
    expect(invitation.pullDomainEvents()).toEqual([
      { type: "InvitationAccepted", invitationId: ID, organizationId: ORG_ID, occurredAt: LATER },
    ]);
  });

  it("rejects accepting an already-accepted invitation", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.accept(LATER);
    expect(() => invitation.accept(LATER)).toThrow(
      /cannot transition invitation from ACCEPTED to ACCEPTED/,
    );
  });

  it("rejects accepting a revoked invitation", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.revoke(LATER);
    expect(() => invitation.accept(LATER)).toThrow(
      /cannot transition invitation from REVOKED to ACCEPTED/,
    );
  });

  it("rejects accepting an expired invitation", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.expire(LATER);
    expect(() => invitation.accept(LATER)).toThrow(
      /cannot transition invitation from EXPIRED to ACCEPTED/,
    );
  });
});

describe("Invitation#revoke", () => {
  it("PENDING -> REVOKED, sets respondedAt, emits InvitationRevoked", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.clearDomainEvents();
    invitation.revoke(LATER);
    expect(invitation.status).toBe(InvitationStatus.Revoked);
    expect(invitation.respondedAt?.getTime()).toBe(LATER.getTime());
    expect(invitation.pullDomainEvents()).toEqual([
      { type: "InvitationRevoked", invitationId: ID, organizationId: ORG_ID, occurredAt: LATER },
    ]);
  });

  it("rejects revoking an already-revoked invitation", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.revoke(LATER);
    expect(() => invitation.revoke(LATER)).toThrow(
      /cannot transition invitation from REVOKED to REVOKED/,
    );
  });

  it("rejects revoking an accepted invitation", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.accept(LATER);
    expect(() => invitation.revoke(LATER)).toThrow(
      /cannot transition invitation from ACCEPTED to REVOKED/,
    );
  });
});

describe("Invitation#expire", () => {
  it("PENDING -> EXPIRED, sets respondedAt, emits InvitationExpired", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.clearDomainEvents();
    invitation.expire(LATER);
    expect(invitation.status).toBe(InvitationStatus.Expired);
    expect(invitation.respondedAt?.getTime()).toBe(LATER.getTime());
    expect(invitation.pullDomainEvents()).toEqual([
      { type: "InvitationExpired", invitationId: ID, organizationId: ORG_ID, occurredAt: LATER },
    ]);
  });

  it("rejects expiring an already-expired invitation", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.expire(LATER);
    expect(() => invitation.expire(LATER)).toThrow(
      /cannot transition invitation from EXPIRED to EXPIRED/,
    );
  });

  it("does not compare now against expiresAt: expire succeeds even called before expiresAt", () => {
    const invitation = createInvitation({ now: NOW, expiresAt: EXPIRES_AT });
    expect(() => invitation.expire(LATER)).not.toThrow();
    expect(invitation.status).toBe(InvitationStatus.Expired);
  });
});

describe("Invitation timestamp monotonicity", () => {
  it("rejects a timestamp earlier than createdAt on accept", () => {
    const invitation = createInvitation({ now: NOW });
    expect(() => invitation.accept(EARLIER)).toThrow(
      /timestamp must not precede the invitation's creation/,
    );
  });

  it("accepts a timestamp equal to createdAt (monotonic allows equality)", () => {
    const invitation = createInvitation({ now: NOW });
    expect(() => invitation.accept(NOW)).not.toThrow();
    expect(invitation.status).toBe(InvitationStatus.Accepted);
  });
});

describe("Invitation event collection", () => {
  it("pullDomainEvents is non-destructive: repeated calls return the same events", () => {
    const invitation = createInvitation({ now: NOW });
    const first = invitation.pullDomainEvents();
    const second = invitation.pullDomainEvents();
    expect(first).toEqual(second);
  });

  it("clearDomainEvents empties the collected events", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.clearDomainEvents();
    expect(invitation.pullDomainEvents()).toEqual([]);
  });

  it("records events in the order operations occurred", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.accept(LATER);

    const types = invitation.pullDomainEvents().map((event) => event.type);
    expect(types).toEqual(["InvitationCreated", "InvitationAccepted"]);
  });

  it("no event is recorded for a rejected (thrown) transition", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.accept(LATER);
    invitation.clearDomainEvents();
    expect(() => invitation.revoke(LATER)).toThrow();
    expect(invitation.pullDomainEvents()).toEqual([]);
  });
});

describe("Invitation immutability expectations", () => {
  it("createdAt getter returns a defensive copy", () => {
    const invitation = createInvitation({ now: NOW });
    const first = invitation.createdAt;
    first.setTime(0);
    expect(invitation.createdAt.getTime()).toBe(NOW.getTime());
  });

  it("expiresAt getter returns a defensive copy", () => {
    const invitation = createInvitation({ expiresAt: EXPIRES_AT });
    const first = invitation.expiresAt;
    first.setTime(0);
    expect(invitation.expiresAt.getTime()).toBe(EXPIRES_AT.getTime());
  });

  it("respondedAt getter returns a defensive copy once set", () => {
    const invitation = createInvitation({ now: NOW });
    invitation.accept(LATER);
    const first = invitation.respondedAt;
    first?.setTime(0);
    expect(invitation.respondedAt?.getTime()).toBe(LATER.getTime());
  });

  it("id, organizationId, email, and invitedBy are stable value objects across repeated getter access", () => {
    const invitation = createInvitation();
    expect(invitation.id.equals(invitation.id)).toBe(true);
    expect(invitation.organizationId.equals(invitation.organizationId)).toBe(true);
    expect(invitation.email.equals(invitation.email)).toBe(true);
    expect(invitation.invitedBy.equals(invitation.invitedBy)).toBe(true);
  });
});
