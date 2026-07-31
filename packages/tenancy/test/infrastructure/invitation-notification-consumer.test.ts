import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { createContext, createEvent, FixedClock, SequentialIdGenerator } from "@corestack/kernel";
import type { Sql } from "postgres";

import { MEMBER_JOINED_EVENT, type MemberJoinedPayload } from "../../src/application/events.js";
import {
  createInvitationNotificationSubscription,
  INVITATION_NOTIFICATION_CONSUMER,
} from "../../src/infrastructure/postgres/invitation-notification-consumer.js";

/**
 * Full atomicity/idempotency/rollback behavior (Section 8) needs a real
 * Postgres connection and is proven in
 * test/integration/tenancy-postgres.postgres.test.ts. This file covers
 * only what's representable without a database: the subscription's own
 * shape, and that an event this consumer doesn't handle is discarded
 * before any transaction is even opened.
 */
describe("createInvitationNotificationSubscription (E05-T14)", () => {
  it("returns a single wildcard subscription under the documented consumer name — never one subscription per event name (checkpoint-collision hazard, see the module doc comment)", () => {
    const sql = {} as Sql;
    const subscription = createInvitationNotificationSubscription({
      sql,
      ids: new SequentialIdGenerator("id-"),
      clock: new FixedClock(new Date("2026-07-31T00:00:00Z")),
    });

    expect(subscription.consumer).toBe(INVITATION_NOTIFICATION_CONSUMER);
    expect(subscription.event).toBe("*");
    expect(typeof subscription.handler).toBe("function");
  });

  it("discards an unhandled event (MEMBER_JOINED) without opening a transaction", async () => {
    const sql = {
      begin: () => {
        throw new Error("must not open a transaction for an event this consumer ignores");
      },
    } as unknown as Sql;
    const subscription = createInvitationNotificationSubscription({
      sql,
      ids: new SequentialIdGenerator("id-"),
      clock: new FixedClock(new Date("2026-07-31T00:00:00Z")),
    });

    const ids = new SequentialIdGenerator("evt-");
    const organizationId = randomUUID();
    const context = createContext({ actor: { type: "system", id: null }, organizationId }, ids);
    const payload: MemberJoinedPayload = {
      organizationId,
      membershipId: randomUUID(),
      userId: randomUUID(),
      role: "MEMBER",
    };
    const event = createEvent(
      { name: MEMBER_JOINED_EVENT, version: 1, payload },
      context,
      { clock: new FixedClock(new Date("2026-07-31T00:00:00Z")), ids },
    );

    await expect(subscription.handler(event)).resolves.toBeUndefined();
  });
});
