import type { TransactionContext } from "@corestack/kernel";

import type { NotificationDeliveryPayload } from "./notification-delivery-payload.js";

/**
 * The persistence port for durable delivery payloads (Section 6). Two
 * operations only: `store` (idempotent — see below) and `findById` (the
 * read Section 8's "durable persistence"/"replay safety" tests and a
 * future provider adapter both need to fetch a payload back out).
 *
 * Not an `OrgScopedRepository` (T31): that base shape exists for use cases
 * running inside a caller-authenticated `OrgScopedContext`, and this
 * repository has no such caller — its only writer (this task's JSON
 * delivery adapter, `infrastructure/postgres/notification-payload-delivery-
 * adapter.ts`) is called with a bare `NotificationWorkItem`, the same
 * "replayed event / background adapter, not a request" shape
 * `NotificationWorkItemRepository` already documents (see that file's own
 * doc comment, and ADR-0026). `tx` is still the generic kernel
 * `TransactionContext`, not a raw `postgres` type, for the same
 * infrastructure-agnostic reason every port in this module is.
 *
 * NOTE for future edits to this file: the fitness rule in
 * `packages/architecture-tests/test/tenant-isolation.test.mjs` (ADR-0021)
 * passes for this file today only because this paragraph mentions
 * "OrgScopedContext" in prose — a text match, not a semantic check. See
 * `notification-work-item-repository.ts`'s identical note and ADR-0026's
 * "known fragility" callout before editing this comment away; the fix is
 * to keep some literal mention (or add the `GlobalRepository` marker
 * instead), not to treat the fitness failure as a real violation.
 *
 * **`store` is an idempotent upsert, not a plain `INSERT`.** Because
 * `buildNotificationDeliveryPayload` is a pure function of its source work
 * item (same `id`, same `createdAt`, same everything), calling `store`
 * twice for the same work item passes the identical payload both times —
 * `store` must tolerate that without erroring or duplicating the row
 * (Section 8: "replay safety"). See
 * `PostgresNotificationDeliveryPayloadRepository.store`'s doc comment for
 * the exact mechanism (`ON CONFLICT (id) DO NOTHING`).
 */
export interface NotificationDeliveryPayloadRepository {
  store(tx: TransactionContext, payload: NotificationDeliveryPayload): Promise<void>;

  /** `null` if no payload with this id has ever been stored. */
  findById(tx: TransactionContext, id: string): Promise<NotificationDeliveryPayload | null>;
}
