/**
 * Purge protocol framework (E03-T33; DB §15: "org deletion fans out
 * `organization.purge_requested`; every schema owns a purge handler
 * deleting its org's rows"; Architecture §20's tenant lifecycle).
 *
 * Deliberately not a new delivery or dedup mechanism — a purge handler is
 * just an ordinary module event subscription (T20's `ModuleInstance.eventHandlers`),
 * wrapped with the kernel's already-shipped `idempotentHandler` (E02-T03)
 * bound to a `ProcessedEventStore` (the same port `PostgresProcessedEventStore`,
 * E03-T14, already implements durably). "Exactly once" registration is
 * already enforced by `createCoreStack`'s existing duplicate `(consumer,
 * event)` detection (E03-T21) — `registerPurgeHandler` just derives a
 * per-module `consumer` name so that check has something unique to catch
 * collisions against. "Completion tracking" is `ProcessedEventStore.hasProcessed`
 * itself: a durable store already answers "has module X finished purging
 * for this specific purge event" with no new schema.
 */
import {
  ValidationError,
  idempotentHandler,
  type DomainEvent,
  type EventSubscription,
} from "@corestack/kernel";
import type { ProcessedEventStore } from "@corestack/kernel";

import { assertValidModuleName } from "../domain/migration-file.js";

export const ORGANIZATION_PURGE_REQUESTED_EVENT = "organization.purge_requested";

/**
 * A module's own purge logic: delete (or otherwise erase) everything this
 * module owns for the given organization. Must be safe to call more than
 * once for the same organization (deleting already-deleted rows is a
 * no-op) — `idempotentHandler`'s dedup covers "don't call it twice for the
 * same delivered event," not "the delete statement itself must tolerate
 * running twice," which is the handler author's own responsibility, same
 * as any other idempotent event consumer in this codebase.
 */
export type PurgeHandler = (organizationId: string, event: DomainEvent) => Promise<void>;

/**
 * Builds the `EventSubscription` a module registers in its own
 * `ModuleInstance.eventHandlers` to participate in the purge protocol.
 * `consumer` is `${moduleName}:purge` — namespaced per module so
 * `createCoreStack`'s existing cross-module duplicate-registration check
 * catches a module that accidentally registers twice, exactly the same
 * way it already catches any other duplicate `(consumer, event)` pair.
 */
export function registerPurgeHandler(
  moduleName: string,
  handler: PurgeHandler,
  store: ProcessedEventStore,
): EventSubscription {
  assertValidModuleName(moduleName);
  const consumer = `${moduleName}:purge`;

  return {
    consumer,
    event: ORGANIZATION_PURGE_REQUESTED_EVENT,
    handler: idempotentHandler(consumer, store, async (event) => {
      if (event.organizationId === null) {
        throw new ValidationError(
          `${ORGANIZATION_PURGE_REQUESTED_EVENT} event ${event.id} has no organizationId — cannot purge`,
          { metadata: { eventId: event.id, module: moduleName } },
        );
      }
      await handler(event.organizationId, event);
    }),
  };
}
