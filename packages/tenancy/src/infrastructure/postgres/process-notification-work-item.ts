/**
 * The notification processing service (E05-T15). One exported function,
 * `processNextNotificationWorkItem` — claims at most one `PENDING` work
 * item, dispatches it to an injected `NotificationDeliveryPort`, and
 * records the outcome. **No loop, no timer, no daemon** (Section 13) —
 * every invocation does exactly one claim-dispatch-record cycle and
 * returns; whatever eventually calls this function repeatedly (a cron
 * job, a CLI command, a real worker process) is explicitly out of scope
 * for this task. See docs/modules/tenancy-notification-processing.md for
 * the full design.
 *
 * **Two transactions, not one.** The claim (`claimNextPending`, its own
 * `PostgresUnitOfWork`) and the outcome record (`markProcessed`/
 * `markFailed`, a second `PostgresUnitOfWork`) are deliberately separate
 * transactions, with the delivery call in between running under no
 * transaction at all — Section 10's permanent policy states "work is
 * claimed before delivery" and "delivery side effects happen after claim"
 * as two distinct bullets, and holding a database transaction open across
 * an I/O call to an external delivery provider (today: the in-memory test
 * adapter; eventually: a real network call) would hold locks and a
 * connection for however long that call takes — the opposite of what a
 * job-queue claim pattern is for. Each of the two transactions elevates
 * to `tenancy_platform` independently, the same one-elevation-per-
 * transaction discipline `invitation-notification-consumer.ts`
 * established, for the same reason: this processor is not scoped to any
 * one organization's request, so there's no `app.current_org` to set, and
 * visibility must come from the platform role's RLS bypass instead.
 */
import type { Clock } from "@corestack/kernel";
import { PostgresUnitOfWork } from "@corestack/platform/postgres";
import type { PostgresTransactionContext } from "@corestack/platform/postgres";
import type { Sql } from "postgres";

import type { NotificationDeliveryPort } from "../../application/notification-delivery-port.js";
import {
  assertNotificationWorkItemDeliverable,
  decideNotificationFailureOutcome,
} from "../../application/notification-processing-decisions.js";
import type { NotificationWorkItem } from "../../application/notification-work-item.js";
import { PostgresNotificationWorkItemRepository } from "./postgres-notification-work-item-repository.js";
import { TENANCY_PLATFORM_ROLE } from "./rls/roles.js";

export interface NotificationProcessingDeps {
  /** The same pool/connection every other tenancy Postgres adapter is given — never a bare `TransactionSql`, since this service opens its own two transaction boundaries. */
  readonly sql: Sql;
  readonly clock: Clock;
  readonly delivery: NotificationDeliveryPort;
}

export type NotificationProcessingResult =
  | { readonly outcome: "no_pending_work" }
  | { readonly outcome: "processed"; readonly workItemId: string }
  | {
      readonly outcome: "failed";
      readonly workItemId: string;
      readonly status: "PENDING" | "FAILED";
      readonly lastError: string;
    };

/** Opens one `PostgresUnitOfWork` transaction, elevates to `tenancy_platform` as its first statement, runs `work`, and commits — the same one-elevation-per-transaction shape `invitation-notification-consumer.ts` established. */
async function elevateAndRun<T>(
  sql: Sql,
  work: (tx: PostgresTransactionContext) => Promise<T>,
): Promise<T> {
  return new PostgresUnitOfWork(sql, null).run(async (tx) => {
    await tx.sql.unsafe(`SET LOCAL ROLE ${TENANCY_PLATFORM_ROLE}`);
    return work(tx);
  });
}

/** Dispatches a claimed, already-validated work item to its matching delivery method. Only ever called after `assertNotificationWorkItemDeliverable` — the non-null assertion on `recipient` relies on that precondition, not a fresh check here. */
async function dispatchNotificationDelivery(
  item: NotificationWorkItem,
  delivery: NotificationDeliveryPort,
): Promise<void> {
  switch (item.type) {
    case "INVITATION_CREATED":
      await delivery.deliverInvitationCreated({
        organizationId: item.organizationId,
        invitationId: item.invitationId,
        recipient: item.recipient!,
      });
      return;
    case "INVITATION_ACCEPTED":
      await delivery.deliverInvitationAccepted({
        organizationId: item.organizationId,
        invitationId: item.invitationId,
      });
      return;
    case "INVITATION_EXPIRED":
      await delivery.deliverInvitationExpired({
        organizationId: item.organizationId,
        invitationId: item.invitationId,
      });
      return;
  }
}

export async function processNextNotificationWorkItem(
  deps: NotificationProcessingDeps,
): Promise<NotificationProcessingResult> {
  const repository = new PostgresNotificationWorkItemRepository();

  const item = await elevateAndRun(deps.sql, (tx) => repository.claimNextPending(tx));
  if (item === null) {
    return { outcome: "no_pending_work" };
  }

  try {
    assertNotificationWorkItemDeliverable(item);
    await dispatchNotificationDelivery(item, deps.delivery);

    await elevateAndRun(deps.sql, (tx) => repository.markProcessed(tx, item.id, deps.clock.now()));
    return { outcome: "processed", workItemId: item.id };
  } catch (error) {
    const attempts = item.attempts + 1;
    const decided = decideNotificationFailureOutcome(attempts, error);

    await elevateAndRun(deps.sql, (tx) =>
      repository.markFailed(tx, item.id, { status: decided.status, attempts, lastError: decided.lastError }),
    );
    return { outcome: "failed", workItemId: item.id, status: decided.status, lastError: decided.lastError };
  }
}
