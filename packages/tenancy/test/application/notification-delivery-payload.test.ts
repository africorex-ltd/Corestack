import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_SUBJECT_BY_TYPE,
  NOTIFICATION_TEMPLATE_BY_TYPE,
  buildNotificationDeliveryPayload,
} from "../../src/application/notification-delivery-payload.js";
import type { NotificationWorkItem } from "../../src/application/notification-work-item.js";

const REFERENCE_DATE = new Date("2026-07-31T12:00:00.000Z");

function buildWorkItem(overrides: Partial<NotificationWorkItem> = {}): NotificationWorkItem {
  return {
    id: randomUUID(),
    type: "INVITATION_CREATED",
    organizationId: randomUUID(),
    invitationId: randomUUID(),
    recipient: "someone@example.com",
    payload: { email: "someone@example.com" },
    status: "PROCESSING",
    attempts: 0,
    createdAt: REFERENCE_DATE,
    processedAt: null,
    lastError: null,
    ...overrides,
  };
}

describe("buildNotificationDeliveryPayload (E05-T16)", () => {
  it("builds the full Section 3 shape from a work item", () => {
    const item = buildWorkItem();
    const payload = buildNotificationDeliveryPayload(item);

    expect(payload).toEqual({
      id: item.id,
      notificationType: "INVITATION_CREATED",
      recipient: "someone@example.com",
      subject: NOTIFICATION_SUBJECT_BY_TYPE.INVITATION_CREATED,
      template: "invitation-created",
      variables: { invitationId: item.invitationId },
      metadata: { organizationId: item.organizationId },
      createdAt: REFERENCE_DATE,
    });
  });

  it("reuses the work item's own id and createdAt rather than minting fresh ones", () => {
    const item = buildWorkItem();
    const payload = buildNotificationDeliveryPayload(item);

    expect(payload.id).toBe(item.id);
    expect(payload.createdAt).toBe(item.createdAt);
  });

  it.each([
    ["INVITATION_CREATED", "invitation-created"],
    ["INVITATION_ACCEPTED", "invitation-accepted"],
    ["INVITATION_EXPIRED", "invitation-expired"],
  ] as const)("maps %s to template %s (Section 4)", (type, template) => {
    const item = buildWorkItem({ type, recipient: type === "INVITATION_CREATED" ? "a@b.com" : null });
    const payload = buildNotificationDeliveryPayload(item);

    expect(payload.template).toBe(template);
    expect(payload.notificationType).toBe(type);
  });

  it("gives every NotificationWorkItemType a non-empty placeholder subject", () => {
    for (const type of ["INVITATION_CREATED", "INVITATION_ACCEPTED", "INVITATION_EXPIRED"] as const) {
      expect(NOTIFICATION_SUBJECT_BY_TYPE[type].length).toBeGreaterThan(0);
      expect(NOTIFICATION_TEMPLATE_BY_TYPE[type].length).toBeGreaterThan(0);
    }
  });

  it("carries recipient: null through unchanged for INVITATION_ACCEPTED/EXPIRED", () => {
    const accepted = buildWorkItem({ type: "INVITATION_ACCEPTED", recipient: null });
    const expired = buildWorkItem({ type: "INVITATION_EXPIRED", recipient: null });

    expect(buildNotificationDeliveryPayload(accepted).recipient).toBeNull();
    expect(buildNotificationDeliveryPayload(expired).recipient).toBeNull();
  });

  it("puts only invitationId in variables and only organizationId in metadata — no internal repository details", () => {
    const item = buildWorkItem();
    const payload = buildNotificationDeliveryPayload(item);

    expect(Object.keys(payload.variables)).toEqual(["invitationId"]);
    expect(Object.keys(payload.metadata)).toEqual(["organizationId"]);
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("attempts");
    expect(payload).not.toHaveProperty("processedAt");
    expect(payload).not.toHaveProperty("lastError");
  });

  it("is deterministic: the same work item builds byte-identical JSON every time (Section 3/8)", () => {
    const item = buildWorkItem();

    const first = JSON.stringify(buildNotificationDeliveryPayload(item));
    const second = JSON.stringify(buildNotificationDeliveryPayload(item));

    expect(first).toBe(second);
  });

  it("two different work items (different id/invitationId/organizationId) build different JSON", () => {
    const a = buildWorkItem();
    const b = buildWorkItem({ id: randomUUID(), invitationId: randomUUID(), organizationId: randomUUID() });

    expect(JSON.stringify(buildNotificationDeliveryPayload(a))).not.toBe(
      JSON.stringify(buildNotificationDeliveryPayload(b)),
    );
  });
});
