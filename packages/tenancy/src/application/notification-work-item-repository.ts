import type { TransactionContext } from "@corestack/kernel";

import type { NotificationWorkItem } from "./notification-work-item.js";

/**
 * The persistence port for notification work items (Section 6). Deliberately
 * minimal — `create` only. This is not an `OrgScopedRepository` (T31): that
 * base shape exists for use cases running inside a caller-authenticated
 * `OrgScopedContext`, and this repository has no such caller — it's written
 * to exclusively by the invitation-notification event consumer
 * (`infrastructure/postgres/invitation-notification-consumer.ts`), which
 * runs from a replayed domain event, not a request. `tx` is still the
 * generic kernel `TransactionContext` (not a raw `postgres` type) for the
 * same reason every other repository port in this module is: the interface
 * stays infrastructure-agnostic even though today's only real caller opens
 * its own `PostgresUnitOfWork` transaction to get one.
 *
 * No `findById`/list method: Section 8's integration tests verify a created
 * row directly against the table (mirroring how the existing integration
 * suite already asserts soft-deleted rows are "still present" via a direct
 * query, not a repository round-trip) — adding a read method with no real
 * caller yet would be exactly the unused-surface mistake E05-T13's second
 * advisor pass caught and removed (`requireNonEmptyString`).
 *
 * NOTE for future edits to this file: the fitness rule in
 * `packages/architecture-tests/test/tenant-isolation.test.mjs`
 * (ADR-0021) passes for this file today only because the paragraph above
 * mentions "OrgScopedContext" in prose — it is a text match, not a
 * semantic check. If that mention is ever edited away, the rule will fail
 * on this port even though nothing about its actual scoping changed. See
 * ADR-0026's "known fragility" note before dropping it; the fix in that
 * case is to keep some literal mention (or add the `GlobalRepository`
 * marker instead), not to treat the failure as a real violation.
 *
 * `claimNextPending`/`markProcessed`/`markFailed` (E05-T15 Section 3) are
 * the only operations the processing service needs — no `findById`, no
 * `countPending`, no `listFailed`; the same "only what a real caller
 * exercises" discipline as `create`'s own doc comment above.
 */
export interface NotificationWorkItemRepository {
  create(tx: TransactionContext, item: NotificationWorkItem): Promise<void>;

  /**
   * Atomically claims and returns the oldest `PENDING` work item,
   * transitioning it to `PROCESSING` in the same statement — or `null` if
   * none is pending. See
   * `PostgresNotificationWorkItemRepository.claimNextPending`'s own doc
   * comment for the exact locking strategy (`FOR UPDATE SKIP LOCKED`) that
   * makes this safe under concurrent callers; this port signature only
   * promises the outcome, not the mechanism, since a future non-Postgres
   * adapter might implement the same contract differently.
   *
   * **Claim semantics (Section 4), promised by every adapter of this
   * port:**
   * - **One worker claims a row.** Two concurrent callers racing for the
   *   same `PENDING` row never both receive it; at most one does, the
   *   other either receives a different pending row or `null`.
   * - **Claiming is a single atomic operation.** There is no window
   *   between "read a pending row" and "mark it claimed" that a second
   *   caller could observe and race into — the read and the status
   *   transition happen in one statement.
   * - **Retries remain visible.** A work item returned to `PENDING` after
   *   a transient failure (see `markFailed`) is claimable again by a
   *   later call — it is not hidden, skipped, or deprioritized.
   * - **Failed rows are not lost.** A work item marked terminally
   *   `FAILED` is never returned by this method again, but the row itself
   *   is never deleted — it remains queryable for operator inspection.
   */
  claimNextPending(tx: TransactionContext): Promise<NotificationWorkItem | null>;

  /**
   * Marks a claimed work item successfully delivered: `status` ->
   * `PROCESSED`, `processedAt` set to the given timestamp, `lastError`
   * cleared. Terminal — a `PROCESSED` row is never returned by
   * `claimNextPending` again (Section 8: "replay of processed item
   * prevented"). Only ever affects a row currently `PROCESSING` — a
   * caller can only mark processed the row it itself just claimed, never
   * a row some other caller has since reclaimed.
   */
  markProcessed(tx: TransactionContext, id: string, processedAt: Date): Promise<void>;

  /**
   * Records a delivery failure with whatever outcome the caller already
   * decided (see `decideNotificationFailureOutcome`,
   * `application/notification-processing-decisions.ts`) — this method
   * only persists it, it does not decide `"PENDING"` vs `"FAILED"` itself.
   * `processedAt` is left untouched (`null`) in both cases; only
   * `markProcessed` ever sets it.
   */
  markFailed(
    tx: TransactionContext,
    id: string,
    outcome: { readonly status: "PENDING" | "FAILED"; readonly attempts: number; readonly lastError: string },
  ): Promise<void>;
}
