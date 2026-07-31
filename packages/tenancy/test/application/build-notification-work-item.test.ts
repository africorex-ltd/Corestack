import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { createContext, createEvent, FixedClock, type IdGenerator } from "@corestack/kernel";

import {
  INVITATION_ACCEPTED_EVENT,
  INVITATION_CREATED_EVENT,
  INVITATION_EXPIRED_EVENT,
  MEMBER_JOINED_EVENT,
  type InvitationAcceptedPayload,
  type InvitationCreatedPayload,
  type InvitationExpiredPayload,
  type MemberJoinedPayload,
} from "../../src/application/events.js";
import { buildNotificationWorkItemFromEvent } from "../../src/application/build-notification-work-item.js";

const REFERENCE_DATE = new Date("2026-07-31T00:00:00.000Z");

class SequentialUuidGenerator implements IdGenerator {
  #next = 0;
  generate(): string {
    this.#next += 1;
    return `00000000-0000-7000-8000-${this.#next.toString().padStart(12, "0")}`;
  }
}

function buildEvent<TPayload>(
  name: string,
  organizationId: string | null,
  payload: TPayload,
): ReturnType<typeof createEvent<TPayload>> {
  const clock = new FixedClock(REFERENCE_DATE);
  const ids = new SequentialUuidGenerator();
  const context = createContext({ actor: { type: "system", id: null }, organizationId }, ids);
  return createEvent({ name, version: 1, payload }, context, { clock, ids });
}

describe("buildNotificationWorkItemFromEvent (E05-T14)", () => {
  const organizationId = randomUUID();
  const invitationId = randomUUID();
  const clock = new FixedClock(REFERENCE_DATE);
  const ids = new SequentialUuidGenerator();

  it("maps INVITATION_CREATED to a PENDING work item with the invitee email as recipient", () => {
    const payload: InvitationCreatedPayload = {
      invitationId,
      organizationId,
      email: "invitee@example.com",
      role: "MEMBER",
      invitedBy: randomUUID(),
      expiresAt: "2026-08-07T00:00:00.000Z",
    };
    const event = buildEvent(INVITATION_CREATED_EVENT, organizationId, payload);

    const item = buildNotificationWorkItemFromEvent(event, { ids, clock });

    expect(item).not.toBeNull();
    expect(item?.type).toBe("INVITATION_CREATED");
    expect(item?.organizationId).toBe(organizationId);
    expect(item?.invitationId).toBe(invitationId);
    expect(item?.recipient).toBe("invitee@example.com");
    expect(item?.payload).toEqual(payload);
    expect(item?.status).toBe("PENDING");
    expect(item?.attempts).toBe(0);
    expect(item?.createdAt.getTime()).toBe(REFERENCE_DATE.getTime());
    expect(item?.processedAt).toBeNull();
    expect(item?.lastError).toBeNull();
    expect(item?.id).toBeTruthy();
  });

  it("maps INVITATION_ACCEPTED to a PENDING work item with a null recipient (the payload carries no email)", () => {
    const payload: InvitationAcceptedPayload = { invitationId, organizationId };
    const event = buildEvent(INVITATION_ACCEPTED_EVENT, organizationId, payload);

    const item = buildNotificationWorkItemFromEvent(event, { ids, clock });

    expect(item?.type).toBe("INVITATION_ACCEPTED");
    expect(item?.recipient).toBeNull();
    expect(item?.payload).toEqual(payload);
  });

  it("maps INVITATION_EXPIRED to a PENDING work item with a null recipient", () => {
    const payload: InvitationExpiredPayload = { invitationId, organizationId };
    const event = buildEvent(INVITATION_EXPIRED_EVENT, organizationId, payload);

    const item = buildNotificationWorkItemFromEvent(event, { ids, clock });

    expect(item?.type).toBe("INVITATION_EXPIRED");
    expect(item?.recipient).toBeNull();
    expect(item?.payload).toEqual(payload);
  });

  it("ignores MEMBER_JOINED (Section 3: 'ignore MEMBER_JOINED for now')", () => {
    const payload: MemberJoinedPayload = {
      organizationId,
      membershipId: randomUUID(),
      userId: randomUUID(),
      role: "MEMBER",
    };
    const event = buildEvent(MEMBER_JOINED_EVENT, organizationId, payload);

    expect(buildNotificationWorkItemFromEvent(event, { ids, clock })).toBeNull();
  });

  it("ignores any other, unrecognized event name", () => {
    const event = buildEvent("tenancy.something.unrelated", organizationId, {});
    expect(buildNotificationWorkItemFromEvent(event, { ids, clock })).toBeNull();
  });

  it("ignores an event with no organizationId, even a handled event name", () => {
    const payload: InvitationCreatedPayload = {
      invitationId,
      organizationId: "unused",
      email: "invitee@example.com",
      role: "MEMBER",
      invitedBy: randomUUID(),
      expiresAt: "2026-08-07T00:00:00.000Z",
    };
    const event = buildEvent(INVITATION_CREATED_EVENT, null, payload);

    expect(buildNotificationWorkItemFromEvent(event, { ids, clock })).toBeNull();
  });

  it("generates a fresh id and uses the injected clock's current time for createdAt, not the event's occurredAt", () => {
    const laterClock = new FixedClock(new Date(REFERENCE_DATE.getTime() + 60_000));
    const payload: InvitationCreatedPayload = {
      invitationId,
      organizationId,
      email: "invitee@example.com",
      role: "ADMIN",
      invitedBy: randomUUID(),
      expiresAt: "2026-08-07T00:00:00.000Z",
    };
    const event = buildEvent(INVITATION_CREATED_EVENT, organizationId, payload);

    const item = buildNotificationWorkItemFromEvent(event, { ids, clock: laterClock });

    expect(item?.createdAt.getTime()).toBe(REFERENCE_DATE.getTime() + 60_000);
    expect(item?.id).not.toBe(event.id);
  });
});
