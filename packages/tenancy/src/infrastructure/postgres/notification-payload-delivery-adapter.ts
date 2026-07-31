/**
 * The JSON delivery adapter (E05-T16 Section 7): receives a
 * `NotificationWorkItem`, builds its stable delivery payload, stores it
 * durably, and returns success. **No network I/O anywhere in this file** —
 * this is the piece Section 1 calls "provider-ready" preparation, not
 * delivery itself.
 *
 * **Deliberately not an implementation of `NotificationDeliveryPort`
 * (E05-T15).** That port's three methods (`deliverInvitationCreated`/
 * `Accepted`/`Expired`) each take only a narrow, per-type payload
 * (`organizationId`/`invitationId`/`recipient` — see
 * `application/notification-delivery-port.ts`), deliberately excluding the
 * work item's own `id` and `createdAt` (T15 Section 5: "do not include
 * internal repository details"). This adapter's payload needs exactly
 * those two fields to be deterministic and replay-safe (see
 * `application/notification-delivery-payload.ts`'s module doc) — fields
 * the port's method signatures never receive. Reusing the work item's `id`
 * is a payload-model decision this task made deliberately, not a leak the
 * port needs to expose; changing the port to carry them would touch T15's
 * already-shipped, tested contract for a need only this task's downstream
 * payload has, which this task's own Section 2 scope does not ask for.
 * Consequence, accepted deliberately: `processNextNotificationWorkItem`
 * does not call this adapter today — wiring the two together (so that
 * every real "delivery" both dispatches through the port *and* persists a
 * payload here) is a composition decision for a future task, once a real
 * provider adapter exists to make that composition worth doing. See
 * docs/modules/tenancy-delivery-payloads.md's "Not wired into the
 * processor" section.
 *
 * **Role elevation, same shape as `process-notification-work-item.ts`.**
 * This adapter isn't scoped to any one organization's request either — it
 * operates on a bare `NotificationWorkItem`, the same "background adapter,
 * not a request" shape ADR-0026 already establishes — so it elevates to
 * `tenancy_platform` for its one transaction rather than setting
 * `app.current_org`.
 */
import { PostgresUnitOfWork } from "@corestack/platform/postgres";
import type { PostgresTransactionContext } from "@corestack/platform/postgres";
import type { Sql } from "postgres";

import { buildNotificationDeliveryPayload } from "../../application/notification-delivery-payload.js";
import type { NotificationWorkItem } from "../../application/notification-work-item.js";
import { PostgresNotificationDeliveryPayloadRepository } from "./postgres-notification-delivery-payload-repository.js";
import { TENANCY_PLATFORM_ROLE } from "./rls/roles.js";

export interface NotificationPayloadDeliveryDeps {
  /** The same pool/connection every other tenancy Postgres adapter is given — this adapter opens its own transaction boundary. */
  readonly sql: Sql;
}

export interface NotificationPayloadDeliveryResult {
  readonly success: true;
  readonly payloadId: string;
}

/** Opens one `PostgresUnitOfWork` transaction, elevates to `tenancy_platform` as its first statement, runs `work`, and commits — identical shape to `process-notification-work-item.ts`'s own local helper. */
async function elevateAndRun<T>(
  sql: Sql,
  work: (tx: PostgresTransactionContext) => Promise<T>,
): Promise<T> {
  return new PostgresUnitOfWork(sql, null).run(async (tx) => {
    await tx.sql.unsafe(`SET LOCAL ROLE ${TENANCY_PLATFORM_ROLE}`);
    return work(tx);
  });
}

/**
 * Builds `item`'s delivery payload and stores it (idempotently — see
 * `PostgresNotificationDeliveryPayloadRepository.store`'s doc comment).
 * Always resolves `{ success: true }` on a normal return — there is no
 * network call in this function that could fail in a way worth
 * distinguishing from an ordinary thrown database error, so unlike
 * `processNextNotificationWorkItem` there is no failure-outcome branch
 * here (Section 7: "returns success", singular — no retry/failure model is
 * asked for).
 */
export async function deliverNotificationWorkItemAsJsonPayload(
  item: NotificationWorkItem,
  deps: NotificationPayloadDeliveryDeps,
): Promise<NotificationPayloadDeliveryResult> {
  const payload = buildNotificationDeliveryPayload(item);
  const repository = new PostgresNotificationDeliveryPayloadRepository();

  await elevateAndRun(deps.sql, (tx) => repository.store(tx, payload));

  return { success: true, payloadId: payload.id };
}
