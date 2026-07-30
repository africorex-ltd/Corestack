import { describe, expect, it } from "vitest";

import { Organization } from "../../src/domain/organization.js";
import { OrganizationStatus } from "../../src/domain/organization-status.js";

const ID = "018f5a3e-7b2c-7000-8000-000000000001";
const NOW = new Date("2026-07-30T00:00:00.000Z");
const LATER = new Date("2026-07-30T01:00:00.000Z");
const EARLIER = new Date("2026-07-29T23:00:00.000Z");

function createActive(overrides: Partial<{ id: string; name: string; slug: string; now: Date }> = {}) {
  return Organization.create({
    id: overrides.id ?? ID,
    name: overrides.name ?? "Acme Corp",
    slug: overrides.slug ?? "acme-corp",
    now: overrides.now ?? NOW,
  });
}

describe("Organization.create", () => {
  it("creates an ACTIVE organization with the given fields", () => {
    const org = createActive();
    expect(org.id.value).toBe(ID);
    expect(org.name).toBe("Acme Corp");
    expect(org.slug.value).toBe("acme-corp");
    expect(org.status).toBe(OrganizationStatus.Active);
    expect(org.deletedAt).toBeNull();
  });

  it("sets createdAt and updatedAt to the given timestamp", () => {
    const org = createActive({ now: NOW });
    expect(org.createdAt.getTime()).toBe(NOW.getTime());
    expect(org.updatedAt.getTime()).toBe(NOW.getTime());
  });

  it("emits exactly one OrganizationCreated event", () => {
    const org = createActive({ now: NOW });
    const events = org.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "OrganizationCreated",
      organizationId: ID,
      occurredAt: NOW,
      name: "Acme Corp",
      slug: "acme-corp",
    });
  });

  it("rejects an invalid id", () => {
    expect(() => createActive({ id: "not-a-uuid" })).toThrow(/invalid organization id/);
  });

  it("rejects a name that is too long", () => {
    expect(() => createActive({ name: "x".repeat(121) })).toThrow(/1-120 characters/);
  });

  it("rejects an empty name", () => {
    expect(() => createActive({ name: "" })).toThrow(/1-120 characters/);
  });

  it("rejects an invalid slug", () => {
    expect(() => createActive({ slug: "Not Valid" })).toThrow(/invalid organization slug/);
  });
});

describe("Organization#rename", () => {
  it("changes the name and updates updatedAt", () => {
    const org = createActive({ now: NOW });
    org.clearDomainEvents();
    org.rename("New Name", LATER);
    expect(org.name).toBe("New Name");
    expect(org.updatedAt.getTime()).toBe(LATER.getTime());
  });

  it("emits OrganizationRenamed with previous and new name", () => {
    const org = createActive({ name: "Old Name", now: NOW });
    org.clearDomainEvents();
    org.rename("New Name", LATER);
    expect(org.pullDomainEvents()).toEqual([
      {
        type: "OrganizationRenamed",
        organizationId: ID,
        occurredAt: LATER,
        previousName: "Old Name",
        name: "New Name",
      },
    ]);
  });

  it("is a no-op when renamed to the current name: no event, updatedAt unchanged", () => {
    const org = createActive({ name: "Same Name", now: NOW });
    org.clearDomainEvents();
    org.rename("Same Name", LATER);
    expect(org.updatedAt.getTime()).toBe(NOW.getTime());
    expect(org.pullDomainEvents()).toEqual([]);
  });

  it("rejects renaming a deleted organization", () => {
    const org = createActive({ now: NOW });
    org.delete(LATER);
    expect(() => org.rename("New Name", LATER)).toThrow(/cannot rename a deleted organization/);
  });

  it("rejects an invalid new name without mutating state", () => {
    const org = createActive({ name: "Valid Name", now: NOW });
    expect(() => org.rename("", LATER)).toThrow(/1-120 characters/);
    expect(org.name).toBe("Valid Name");
    expect(org.updatedAt.getTime()).toBe(NOW.getTime());
  });

  it("rejects a timestamp earlier than the last update", () => {
    const org = createActive({ now: NOW });
    expect(() => org.rename("New Name", EARLIER)).toThrow(
      /timestamp must not precede the organization's last update/,
    );
  });

  it("accepts a timestamp equal to the last update (monotonic allows equality)", () => {
    const org = createActive({ name: "Old", now: NOW });
    expect(() => org.rename("New", NOW)).not.toThrow();
    expect(org.name).toBe("New");
  });
});

describe("Organization#suspend / #reactivate", () => {
  it("suspend: ACTIVE -> SUSPENDED, emits OrganizationSuspended", () => {
    const org = createActive({ now: NOW });
    org.clearDomainEvents();
    org.suspend(LATER);
    expect(org.status).toBe(OrganizationStatus.Suspended);
    expect(org.updatedAt.getTime()).toBe(LATER.getTime());
    expect(org.pullDomainEvents()).toEqual([
      { type: "OrganizationSuspended", organizationId: ID, occurredAt: LATER },
    ]);
  });

  it("reactivate: SUSPENDED -> ACTIVE, emits OrganizationReactivated", () => {
    const org = createActive({ now: NOW });
    org.suspend(LATER);
    org.clearDomainEvents();
    const evenLater = new Date(LATER.getTime() + 1000);
    org.reactivate(evenLater);
    expect(org.status).toBe(OrganizationStatus.Active);
    expect(org.pullDomainEvents()).toEqual([
      { type: "OrganizationReactivated", organizationId: ID, occurredAt: evenLater },
    ]);
  });

  it("suspending an already-suspended organization is an error, not a no-op", () => {
    const org = createActive({ now: NOW });
    org.suspend(LATER);
    expect(() => org.suspend(LATER)).toThrow(/cannot transition organization from SUSPENDED to SUSPENDED/);
  });

  it("reactivating an already-active organization is an error, not a no-op", () => {
    const org = createActive({ now: NOW });
    expect(() => org.reactivate(LATER)).toThrow(/cannot transition organization from ACTIVE to ACTIVE/);
  });

  it("cannot suspend a deleted organization", () => {
    const org = createActive({ now: NOW });
    org.delete(LATER);
    expect(() => org.suspend(LATER)).toThrow(/cannot transition organization from DELETED to SUSPENDED/);
  });

  it("cannot reactivate a deleted organization", () => {
    const org = createActive({ now: NOW });
    org.delete(LATER);
    expect(() => org.reactivate(LATER)).toThrow(/cannot transition organization from DELETED to ACTIVE/);
  });
});

describe("Organization#delete", () => {
  it("deletes an ACTIVE organization, setting deletedAt and status", () => {
    const org = createActive({ now: NOW });
    org.clearDomainEvents();
    org.delete(LATER);
    expect(org.status).toBe(OrganizationStatus.Deleted);
    expect(org.deletedAt?.getTime()).toBe(LATER.getTime());
    expect(org.pullDomainEvents()).toEqual([
      { type: "OrganizationDeleted", organizationId: ID, occurredAt: LATER },
    ]);
  });

  it("deletes a SUSPENDED organization", () => {
    const org = createActive({ now: NOW });
    org.suspend(LATER);
    const evenLater = new Date(LATER.getTime() + 1000);
    org.delete(evenLater);
    expect(org.status).toBe(OrganizationStatus.Deleted);
  });

  it("DELETED is terminal: deleting twice throws", () => {
    const org = createActive({ now: NOW });
    org.delete(LATER);
    expect(() => org.delete(LATER)).toThrow(/cannot transition organization from DELETED to DELETED/);
  });
});

describe("Organization event collection", () => {
  it("pullDomainEvents is non-destructive: repeated calls return the same events", () => {
    const org = createActive({ now: NOW });
    const first = org.pullDomainEvents();
    const second = org.pullDomainEvents();
    expect(first).toEqual(second);
  });

  it("clearDomainEvents empties the collected events", () => {
    const org = createActive({ now: NOW });
    org.clearDomainEvents();
    expect(org.pullDomainEvents()).toEqual([]);
  });

  it("records events in the order operations occurred", () => {
    const org = createActive({ now: NOW });
    org.rename("Renamed", LATER);
    const suspendAt = new Date(LATER.getTime() + 1000);
    org.suspend(suspendAt);
    const reactivateAt = new Date(suspendAt.getTime() + 1000);
    org.reactivate(reactivateAt);

    const types = org.pullDomainEvents().map((event) => event.type);
    expect(types).toEqual([
      "OrganizationCreated",
      "OrganizationRenamed",
      "OrganizationSuspended",
      "OrganizationReactivated",
    ]);
  });

  it("exactly one event is recorded per successful state change (no duplicates on repeated pulls, none on no-ops)", () => {
    const org = createActive({ now: NOW });
    org.rename("Same Name".repeat(0) || "Acme Corp", LATER); // no-op rename (same name as creation)
    expect(org.pullDomainEvents()).toHaveLength(1); // only OrganizationCreated — rename no-op added nothing
  });
});

describe("Organization immutability expectations", () => {
  it("createdAt getter returns a defensive copy", () => {
    const org = createActive({ now: NOW });
    const first = org.createdAt;
    first.setTime(0);
    expect(org.createdAt.getTime()).toBe(NOW.getTime());
  });

  it("updatedAt getter returns a defensive copy", () => {
    const org = createActive({ now: NOW });
    const first = org.updatedAt;
    first.setTime(0);
    expect(org.updatedAt.getTime()).toBe(NOW.getTime());
  });

  it("deletedAt getter returns a defensive copy once set", () => {
    const org = createActive({ now: NOW });
    org.delete(LATER);
    const first = org.deletedAt;
    first?.setTime(0);
    expect(org.deletedAt?.getTime()).toBe(LATER.getTime());
  });

  it("id and slug are stable value objects across repeated getter access", () => {
    const org = createActive({ now: NOW });
    expect(org.id.equals(org.id)).toBe(true);
    expect(org.slug.equals(org.slug)).toBe(true);
  });
});
