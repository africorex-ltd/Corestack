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
 */
export interface NotificationWorkItemRepository {
  create(tx: TransactionContext, item: NotificationWorkItem): Promise<void>;
}
