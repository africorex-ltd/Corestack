import { describe, expect, it } from "vitest";

import { Membership } from "../../src/domain/membership.js";
import { MembershipRole } from "../../src/domain/membership-role.js";
import { MembershipStatus } from "../../src/domain/membership-status.js";

const ID = "018f5a3e-7b2c-7000-8000-000000000001";
const ORG_ID = "018f5a3e-7b2c-7000-8000-000000000002";
const USER_ID = "018f5a3e-7b2c-7000-8000-000000000003";
const NOW = new Date("2026-07-30T00:00:00.000Z");
const LATER = new Date("2026-07-30T01:00:00.000Z");
const EARLIER = new Date("2026-07-29T23:00:00.000Z");

function createMember(
  overrides: Partial<{
    id: string;
    organizationId: string;
    userId: string;
    role: MembershipRole;
    now: Date;
  }> = {},
) {
  return Membership.create({
    id: overrides.id ?? ID,
    organizationId: overrides.organizationId ?? ORG_ID,
    userId: overrides.userId ?? USER_ID,
    role: overrides.role ?? MembershipRole.Member,
    now: overrides.now ?? NOW,
  });
}

describe("Membership.create", () => {
  it("creates an ACTIVE membership with the given fields", () => {
    const membership = createMember({ role: MembershipRole.Member });
    expect(membership.id.value).toBe(ID);
    expect(membership.organizationId.value).toBe(ORG_ID);
    expect(membership.userId.value).toBe(USER_ID);
    expect(membership.role).toBe(MembershipRole.Member);
    expect(membership.status).toBe(MembershipStatus.Active);
    expect(membership.removedAt).toBeNull();
  });

  it("sets joinedAt and updatedAt to the given timestamp", () => {
    const membership = createMember({ now: NOW });
    expect(membership.joinedAt.getTime()).toBe(NOW.getTime());
    expect(membership.updatedAt.getTime()).toBe(NOW.getTime());
  });

  it("can be created directly at OWNER", () => {
    const membership = createMember({ role: MembershipRole.Owner });
    expect(membership.role).toBe(MembershipRole.Owner);
  });

  it("emits exactly one MembershipCreated event", () => {
    const membership = createMember({ role: MembershipRole.Admin, now: NOW });
    const events = membership.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "MembershipCreated",
      membershipId: ID,
      organizationId: ORG_ID,
      occurredAt: NOW,
      userId: USER_ID,
      role: MembershipRole.Admin,
    });
  });

  it("rejects an invalid membership id", () => {
    expect(() => createMember({ id: "not-a-uuid" })).toThrow(/invalid membership id/);
  });

  it("rejects an invalid organization id", () => {
    expect(() => createMember({ organizationId: "not-a-uuid" })).toThrow(
      /invalid organization id/,
    );
  });

  it("rejects an invalid user id", () => {
    expect(() => createMember({ userId: "not-a-uuid" })).toThrow(/invalid user id/);
  });
});

describe("Membership#promoteToAdmin", () => {
  it("MEMBER -> ADMIN, updates updatedAt, emits MembershipPromoted", () => {
    const membership = createMember({ role: MembershipRole.Member, now: NOW });
    membership.clearDomainEvents();
    membership.promoteToAdmin(LATER);
    expect(membership.role).toBe(MembershipRole.Admin);
    expect(membership.updatedAt.getTime()).toBe(LATER.getTime());
    expect(membership.pullDomainEvents()).toEqual([
      {
        type: "MembershipPromoted",
        membershipId: ID,
        organizationId: ORG_ID,
        occurredAt: LATER,
        previousRole: MembershipRole.Member,
        role: MembershipRole.Admin,
      },
    ]);
  });

  it("rejects promoting an OWNER (owner cannot be downgraded through this aggregate)", () => {
    const membership = createMember({ role: MembershipRole.Owner, now: NOW });
    expect(() => membership.promoteToAdmin(LATER)).toThrow(
      /cannot change membership role from OWNER to ADMIN/,
    );
  });

  it("rejects promoting an already-ADMIN membership (invalid self-transition, not a no-op)", () => {
    const membership = createMember({ role: MembershipRole.Admin, now: NOW });
    expect(() => membership.promoteToAdmin(LATER)).toThrow(
      /cannot change membership role from ADMIN to ADMIN/,
    );
  });

  it("rejects promoting a removed membership", () => {
    const membership = createMember({ role: MembershipRole.Member, now: NOW });
    membership.remove(LATER);
    expect(() => membership.promoteToAdmin(LATER)).toThrow(
      /cannot promote a removed membership/,
    );
  });
});

describe("Membership#demoteToMember", () => {
  it("ADMIN -> MEMBER, updates updatedAt, emits MembershipDemoted", () => {
    const membership = createMember({ role: MembershipRole.Admin, now: NOW });
    membership.clearDomainEvents();
    membership.demoteToMember(LATER);
    expect(membership.role).toBe(MembershipRole.Member);
    expect(membership.updatedAt.getTime()).toBe(LATER.getTime());
    expect(membership.pullDomainEvents()).toEqual([
      {
        type: "MembershipDemoted",
        membershipId: ID,
        organizationId: ORG_ID,
        occurredAt: LATER,
        previousRole: MembershipRole.Admin,
        role: MembershipRole.Member,
      },
    ]);
  });

  it("rejects demoting an OWNER (owner cannot be demoted through this aggregate)", () => {
    const membership = createMember({ role: MembershipRole.Owner, now: NOW });
    expect(() => membership.demoteToMember(LATER)).toThrow(
      /cannot change membership role from OWNER to MEMBER/,
    );
  });

  it("rejects demoting an already-MEMBER membership (invalid self-transition, not a no-op)", () => {
    const membership = createMember({ role: MembershipRole.Member, now: NOW });
    expect(() => membership.demoteToMember(LATER)).toThrow(
      /cannot change membership role from MEMBER to MEMBER/,
    );
  });

  it("rejects demoting a removed membership", () => {
    const membership = createMember({ role: MembershipRole.Admin, now: NOW });
    membership.remove(LATER);
    expect(() => membership.demoteToMember(LATER)).toThrow(
      /cannot demote a removed membership/,
    );
  });
});

describe("Membership#suspend / #reactivate", () => {
  it("suspend: ACTIVE -> SUSPENDED, emits MembershipSuspended", () => {
    const membership = createMember({ now: NOW });
    membership.clearDomainEvents();
    membership.suspend(LATER);
    expect(membership.status).toBe(MembershipStatus.Suspended);
    expect(membership.updatedAt.getTime()).toBe(LATER.getTime());
    expect(membership.pullDomainEvents()).toEqual([
      { type: "MembershipSuspended", membershipId: ID, organizationId: ORG_ID, occurredAt: LATER },
    ]);
  });

  it("reactivate: SUSPENDED -> ACTIVE, emits MembershipReactivated", () => {
    const membership = createMember({ now: NOW });
    membership.suspend(LATER);
    membership.clearDomainEvents();
    const evenLater = new Date(LATER.getTime() + 1000);
    membership.reactivate(evenLater);
    expect(membership.status).toBe(MembershipStatus.Active);
    expect(membership.pullDomainEvents()).toEqual([
      {
        type: "MembershipReactivated",
        membershipId: ID,
        organizationId: ORG_ID,
        occurredAt: evenLater,
      },
    ]);
  });

  it("suspending an already-suspended membership is an error, not a no-op", () => {
    const membership = createMember({ now: NOW });
    membership.suspend(LATER);
    expect(() => membership.suspend(LATER)).toThrow(
      /cannot transition membership from SUSPENDED to SUSPENDED/,
    );
  });

  it("reactivating an already-active membership is an error, not a no-op", () => {
    const membership = createMember({ now: NOW });
    expect(() => membership.reactivate(LATER)).toThrow(
      /cannot transition membership from ACTIVE to ACTIVE/,
    );
  });

  it("cannot suspend a removed membership", () => {
    const membership = createMember({ role: MembershipRole.Member, now: NOW });
    membership.remove(LATER);
    expect(() => membership.suspend(LATER)).toThrow(
      /cannot transition membership from REMOVED to SUSPENDED/,
    );
  });

  it("cannot reactivate a removed membership", () => {
    const membership = createMember({ role: MembershipRole.Member, now: NOW });
    membership.remove(LATER);
    expect(() => membership.reactivate(LATER)).toThrow(
      /cannot transition membership from REMOVED to ACTIVE/,
    );
  });

  it("an OWNER can be suspended and reactivated (role is untouched by status changes)", () => {
    const membership = createMember({ role: MembershipRole.Owner, now: NOW });
    membership.suspend(LATER);
    expect(membership.role).toBe(MembershipRole.Owner);
    const evenLater = new Date(LATER.getTime() + 1000);
    membership.reactivate(evenLater);
    expect(membership.role).toBe(MembershipRole.Owner);
  });
});

describe("Membership#remove", () => {
  it("removes an ACTIVE membership, setting removedAt and status", () => {
    const membership = createMember({ role: MembershipRole.Member, now: NOW });
    membership.clearDomainEvents();
    membership.remove(LATER);
    expect(membership.status).toBe(MembershipStatus.Removed);
    expect(membership.removedAt?.getTime()).toBe(LATER.getTime());
    expect(membership.pullDomainEvents()).toEqual([
      { type: "MembershipRemoved", membershipId: ID, organizationId: ORG_ID, occurredAt: LATER },
    ]);
  });

  it("removes a SUSPENDED membership", () => {
    const membership = createMember({ role: MembershipRole.Member, now: NOW });
    membership.suspend(LATER);
    const evenLater = new Date(LATER.getTime() + 1000);
    membership.remove(evenLater);
    expect(membership.status).toBe(MembershipStatus.Removed);
  });

  it("rejects removing an OWNER regardless of status", () => {
    const membership = createMember({ role: MembershipRole.Owner, now: NOW });
    expect(() => membership.remove(LATER)).toThrow(
      /cannot remove a membership with the OWNER role/,
    );
  });

  it("rejects removing a suspended OWNER (role check runs before the status transition)", () => {
    const membership = createMember({ role: MembershipRole.Owner, now: NOW });
    membership.suspend(LATER);
    expect(() => membership.remove(LATER)).toThrow(
      /cannot remove a membership with the OWNER role/,
    );
  });

  it("REMOVED is terminal: removing twice throws", () => {
    const membership = createMember({ role: MembershipRole.Member, now: NOW });
    membership.remove(LATER);
    expect(() => membership.remove(LATER)).toThrow(
      /cannot transition membership from REMOVED to REMOVED/,
    );
  });
});

describe("Membership timestamp monotonicity", () => {
  it("rejects a timestamp earlier than the last update on suspend", () => {
    const membership = createMember({ now: NOW });
    expect(() => membership.suspend(EARLIER)).toThrow(
      /timestamp must not precede the membership's last update/,
    );
  });

  it("accepts a timestamp equal to the last update (monotonic allows equality)", () => {
    const membership = createMember({ role: MembershipRole.Member, now: NOW });
    expect(() => membership.promoteToAdmin(NOW)).not.toThrow();
    expect(membership.role).toBe(MembershipRole.Admin);
  });
});

describe("Membership event collection", () => {
  it("pullDomainEvents is non-destructive: repeated calls return the same events", () => {
    const membership = createMember({ now: NOW });
    const first = membership.pullDomainEvents();
    const second = membership.pullDomainEvents();
    expect(first).toEqual(second);
  });

  it("clearDomainEvents empties the collected events", () => {
    const membership = createMember({ now: NOW });
    membership.clearDomainEvents();
    expect(membership.pullDomainEvents()).toEqual([]);
  });

  it("records events in the order operations occurred", () => {
    const membership = createMember({ role: MembershipRole.Member, now: NOW });
    membership.promoteToAdmin(LATER);
    const suspendAt = new Date(LATER.getTime() + 1000);
    membership.suspend(suspendAt);
    const reactivateAt = new Date(suspendAt.getTime() + 1000);
    membership.reactivate(reactivateAt);
    const demoteAt = new Date(reactivateAt.getTime() + 1000);
    membership.demoteToMember(demoteAt);
    const removeAt = new Date(demoteAt.getTime() + 1000);
    membership.remove(removeAt);

    const types = membership.pullDomainEvents().map((event) => event.type);
    expect(types).toEqual([
      "MembershipCreated",
      "MembershipPromoted",
      "MembershipSuspended",
      "MembershipReactivated",
      "MembershipDemoted",
      "MembershipRemoved",
    ]);
  });

  it("no event is recorded for a rejected (thrown) transition", () => {
    const membership = createMember({ role: MembershipRole.Owner, now: NOW });
    membership.clearDomainEvents();
    expect(() => membership.remove(LATER)).toThrow();
    expect(membership.pullDomainEvents()).toEqual([]);
  });
});

describe("Membership immutability expectations", () => {
  it("joinedAt getter returns a defensive copy", () => {
    const membership = createMember({ now: NOW });
    const first = membership.joinedAt;
    first.setTime(0);
    expect(membership.joinedAt.getTime()).toBe(NOW.getTime());
  });

  it("updatedAt getter returns a defensive copy", () => {
    const membership = createMember({ now: NOW });
    const first = membership.updatedAt;
    first.setTime(0);
    expect(membership.updatedAt.getTime()).toBe(NOW.getTime());
  });

  it("removedAt getter returns a defensive copy once set", () => {
    const membership = createMember({ role: MembershipRole.Member, now: NOW });
    membership.remove(LATER);
    const first = membership.removedAt;
    first?.setTime(0);
    expect(membership.removedAt?.getTime()).toBe(LATER.getTime());
  });

  it("id, organizationId, and userId are stable value objects across repeated getter access", () => {
    const membership = createMember({ now: NOW });
    expect(membership.id.equals(membership.id)).toBe(true);
    expect(membership.organizationId.equals(membership.organizationId)).toBe(true);
    expect(membership.userId.equals(membership.userId)).toBe(true);
  });
});
