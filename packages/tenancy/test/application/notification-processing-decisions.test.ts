import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { NotificationWorkItem } from "../../src/application/notification-work-item.js";
import { NotificationDeliveryPermanentError } from "../../src/application/notification-delivery-port.js";
import {
  MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
  assertNotificationWorkItemDeliverable,
  decideNotificationFailureOutcome,
} from "../../src/application/notification-processing-decisions.js";

function buildWorkItem(overrides: Partial<NotificationWorkItem> = {}): NotificationWorkItem {
  return {
    id: randomUUID(),
    type: "INVITATION_CREATED",
    organizationId: randomUUID(),
    invitationId: randomUUID(),
    recipient: "invitee@example.com",
    payload: {},
    status: "PROCESSING",
    attempts: 0,
    createdAt: new Date("2026-07-31T00:00:00.000Z"),
    processedAt: null,
    lastError: null,
    ...overrides,
  };
}

describe("decideNotificationFailureOutcome (E05-T15)", () => {
  it("returns to PENDING while attempts remain under the threshold", () => {
    const outcome = decideNotificationFailureOutcome(1, new Error("network timeout"));
    expect(outcome.status).toBe("PENDING");
    expect(outcome.lastError).toBe("network timeout");
  });

  it("stays PENDING for every attempt strictly below the threshold", () => {
    for (let attempts = 1; attempts < MAX_NOTIFICATION_DELIVERY_ATTEMPTS; attempts += 1) {
      expect(decideNotificationFailureOutcome(attempts, new Error("x")).status).toBe("PENDING");
    }
  });

  it("resolves to FAILED once attempts reach the threshold", () => {
    const outcome = decideNotificationFailureOutcome(
      MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
      new Error("still failing"),
    );
    expect(outcome.status).toBe("FAILED");
    expect(outcome.lastError).toBe("still failing");
  });

  it("resolves to FAILED for any attempts count beyond the threshold", () => {
    const outcome = decideNotificationFailureOutcome(
      MAX_NOTIFICATION_DELIVERY_ATTEMPTS + 10,
      new Error("still failing"),
    );
    expect(outcome.status).toBe("FAILED");
  });

  it("resolves a NotificationDeliveryPermanentError to FAILED regardless of attempts", () => {
    const outcome = decideNotificationFailureOutcome(
      1,
      new NotificationDeliveryPermanentError("unknown notification work item type: X"),
    );
    expect(outcome.status).toBe("FAILED");
    expect(outcome.lastError).toBe("unknown notification work item type: X");
  });

  it("stringifies a non-Error thrown value rather than throwing itself", () => {
    const outcome = decideNotificationFailureOutcome(1, "a plain string rejection");
    expect(outcome.lastError).toBe("a plain string rejection");
    expect(outcome.status).toBe("PENDING");
  });
});

describe("assertNotificationWorkItemDeliverable (E05-T15)", () => {
  it("allows an INVITATION_CREATED item with a non-null recipient", () => {
    expect(() =>
      assertNotificationWorkItemDeliverable(buildWorkItem({ type: "INVITATION_CREATED", recipient: "a@b.com" })),
    ).not.toThrow();
  });

  it("allows an INVITATION_ACCEPTED item with a null recipient", () => {
    expect(() =>
      assertNotificationWorkItemDeliverable(buildWorkItem({ type: "INVITATION_ACCEPTED", recipient: null })),
    ).not.toThrow();
  });

  it("allows an INVITATION_EXPIRED item with a null recipient", () => {
    expect(() =>
      assertNotificationWorkItemDeliverable(buildWorkItem({ type: "INVITATION_EXPIRED", recipient: null })),
    ).not.toThrow();
  });

  it("throws NotificationDeliveryPermanentError for INVITATION_CREATED with a null recipient", () => {
    const item = buildWorkItem({ type: "INVITATION_CREATED", recipient: null });
    expect(() => assertNotificationWorkItemDeliverable(item)).toThrow(NotificationDeliveryPermanentError);
    expect(() => assertNotificationWorkItemDeliverable(item)).toThrow(new RegExp(item.id));
  });

  it("throws NotificationDeliveryPermanentError for an unrecognized type", () => {
    const item = buildWorkItem({
      type: "UNKNOWN_TYPE" as unknown as NotificationWorkItem["type"],
    });
    expect(() => assertNotificationWorkItemDeliverable(item)).toThrow(NotificationDeliveryPermanentError);
    expect(() => assertNotificationWorkItemDeliverable(item)).toThrow(/unknown notification work item type/);
  });
});
