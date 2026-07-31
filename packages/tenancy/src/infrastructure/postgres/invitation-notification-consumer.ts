/**
 * The invitation-notification `EventSubscription` (E05-T14). Wires
 * `buildNotificationWorkItemFromEvent` (pure) to
 * `PostgresNotificationWorkItemRepository` (I/O) behind one idempotent,
 * transactionally-atomic handler — see
 * docs/modules/tenancy-notification-orchestration.md for the full design.
 *
 * **A single wildcard subscription, not three.** `EventSubscription.consumer`
 * doubles as the outbox relay's checkpoint identity
 * (`OutboxRelayStore.getCheckpoint(consumer)` — keyed by consumer name
 * alone, not `(consumer, event)`). Three subscriptions sharing one consumer
 * name across three different event names would each read/advance the
 * *same* checkpoint row independently — exactly the corruption
 * `create-core-stack.ts`'s own duplicate-registration check calls out by
 * name ("this would corrupt outbox checkpoint tracking"), and that check
 * only catches an *identical* `(consumer, event)` pair, not three distinct
 * event names sharing one consumer, so nothing would flag this at
 * composition time — it would only surface as silently-wrong checkpoint
 * advancement in production. One subscription with `event: "*"`, filtering
 * internally, has exactly one checkpoint and sidesteps the hazard
 * entirely. Consequence, accepted deliberately: this consumer's checkpoint
 * advances across every event in the outbox, not just the three it acts
 * on (`runSubscription` advances past non-matching events too) — correct
 * behavior, not a surprise, at today's event volume.
 *
 * **Atomicity, not the generic `idempotentHandler`.** The kernel's
 * `idempotentHandler` wrapper (`processed-events.ts`) calls
 * `hasProcessed`, the handler, and `markProcessed` as three separate
 * steps — enough for at-least-once dedup, not enough for "the work-item
 * insert and the processed-mark commit or roll back together"
 * (Section 8's "transaction rollback safety" test). This handler instead
 * opens its own `PostgresUnitOfWork` transaction and sequences
 * hasProcessed -> build -> insert -> markProcessed by hand, all against
 * the one open transaction — exactly the atomicity
 * `PostgresProcessedEventStore`'s own doc comment describes as possible
 * "when the caller explicitly wires it this way."
 *
 * **Role elevation, not `app.current_org`.** `PostgresUnitOfWork` is
 * constructed with `organizationId: null` — this consumer isn't scoped to
 * any one organization's request, so there's nothing to set
 * `app.current_org` to. Visibility instead comes from `SET LOCAL ROLE
 * tenancy_platform` (E05-T11's existing elevation grant), issued **once,
 * as the first statement in this transaction** — before the
 * `ProcessedEventStore` check, not just before the work-item insert. Both
 * `platform.processed_events` (this task's new grant,
 * `ensure-tenancy-postgres-roles.ts`) and `tenancy.notification_work_items`
 * (this task's migration) only grant `tenancy_platform`, not `tenancy_app`
 * — `hasProcessed`/`markProcessed` need the elevation exactly as much as
 * the insert does, and unlike `existsBySlug`/`findBySlug` (which
 * `RESET ROLE` immediately because their surrounding transaction keeps
 * running as `tenancy_app` for other calls), this transaction never resets:
 * everything after the first statement, for the rest of this one
 * handler-owned transaction, needs to stay elevated.
 */
import {
  type Clock,
  type DomainEvent,
  type EventHandler,
  type EventSubscription,
  type IdGenerator,
} from "@corestack/kernel";
import { PostgresProcessedEventStore, PostgresUnitOfWork } from "@corestack/platform/postgres";
import type { Sql } from "postgres";

import { buildNotificationWorkItemFromEvent } from "../../application/build-notification-work-item.js";
import {
  INVITATION_ACCEPTED_EVENT,
  INVITATION_CREATED_EVENT,
  INVITATION_EXPIRED_EVENT,
} from "../../application/events.js";
import { PostgresNotificationWorkItemRepository } from "./postgres-notification-work-item-repository.js";
import { TENANCY_PLATFORM_ROLE } from "./rls/roles.js";

/** Stable across restarts and deploys — this literal string is also this consumer's outbox checkpoint key and its `platform.processed_events` dedup key. Renaming it resets both. */
export const INVITATION_NOTIFICATION_CONSUMER = "tenancy:invitation-notifications";

const HANDLED_EVENT_NAMES: ReadonlySet<string> = new Set([
  INVITATION_CREATED_EVENT,
  INVITATION_ACCEPTED_EVENT,
  INVITATION_EXPIRED_EVENT,
]);

export interface InvitationNotificationConsumerDeps {
  /** The same pool/connection every other tenancy Postgres adapter is given — never a bare `TransactionSql`, since this handler owns its own transaction boundary. */
  readonly sql: Sql;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

function buildHandler(deps: InvitationNotificationConsumerDeps): EventHandler {
  const repository = new PostgresNotificationWorkItemRepository();

  return async (event: DomainEvent): Promise<void> => {
    if (!HANDLED_EVENT_NAMES.has(event.name)) return;

    await new PostgresUnitOfWork(deps.sql, null).run(async (tx) => {
      await tx.sql.unsafe(`SET LOCAL ROLE ${TENANCY_PLATFORM_ROLE}`);

      const processedEventStore = new PostgresProcessedEventStore(tx.sql);
      if (await processedEventStore.hasProcessed(INVITATION_NOTIFICATION_CONSUMER, event.id)) {
        return;
      }

      const item = buildNotificationWorkItemFromEvent(event, deps);
      if (item !== null) {
        await repository.create(tx, item);
      }

      await processedEventStore.markProcessed(INVITATION_NOTIFICATION_CONSUMER, event.id);
    });
  };
}

/**
 * Builds the one `EventSubscription` a composition root wires into
 * `ModuleInstance.eventHandlers` (or an `EventBus`/`OutboxRelay` directly)
 * to turn invitation domain events into durable notification work items.
 * Not wired into `createTenancyModule` by this task — see
 * docs/modules/tenancy-notification-orchestration.md's "Not wired into
 * the module scaffold" section for why, mirroring E05-T13's identical cut
 * for `tenancyRoutes`.
 */
export function createInvitationNotificationSubscription(
  deps: InvitationNotificationConsumerDeps,
): EventSubscription {
  return {
    consumer: INVITATION_NOTIFICATION_CONSUMER,
    event: "*",
    handler: buildHandler(deps),
  };
}
