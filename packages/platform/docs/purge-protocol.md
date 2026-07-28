# Component Spec — Purge Protocol Framework

- **Task:** E03-T33 · **Status:** Implemented · **Category:** APP (composition over already-shipped primitives, no new infrastructure)
- **ADR references:** ADR-0009 (transactional outbox pattern — delivery semantics this protocol relies on), ADR-0008 (tenant lifecycle: "org deletion is a two-phase process... every module registers a purge handler for its org-owned data")
- **Design docs:** [Database §15](../../docs/architecture/DATABASE.md) ("org deletion fans out `organization.purge_requested`; every schema owns a purge handler deleting its org's rows"), [Architecture §20](../../docs/architecture/ARCHITECTURE.md) (tenant lifecycle)

## Contract

**Purpose:** give every module a standard, correct way to participate in
organization purge — register once, get exactly-once-per-delivery
semantics and durable completion tracking for free.

**Public surface:**

| Export                               | Layer       | Purpose                                                                            |
| ------------------------------------ | ----------- | ---------------------------------------------------------------------------------- |
| `ORGANIZATION_PURGE_REQUESTED_EVENT` | application | The event name every purge handler subscribes to: `"organization.purge_requested"` |
| `PurgeHandler`                       | application | A module's own purge logic: `(organizationId, event) => Promise<void>`             |
| `registerPurgeHandler`               | application | Builds the `EventSubscription` a module adds to its own `eventHandlers`            |

## Deliberately not a new mechanism

Every piece this component needs already shipped in an earlier E03 task:

- **Delivery, exactly-once-per-redelivery semantics:** kernel's
  `idempotentHandler` (E02-T03) + a `ProcessedEventStore`.
  `PostgresProcessedEventStore` (E03-T14) is the durable implementation —
  its own integration suite already proves the generic dedup/retry
  behavior this component relies on.
- **Registration, and catching a module that double-registers:**
  `ModuleInstance.eventHandlers` (E03-T20) is where a purge handler lives;
  `createCoreStack`'s existing duplicate `(consumer, event)` detection
  (E03-T21) already rejects two registrations under the same pair at boot
  time. `registerPurgeHandler` only needs to give that check something
  unique to compare — a `consumer` namespaced per module
  (`${moduleName}:purge`) is sufficient, since two different modules
  necessarily use two different names, and a module can't accidentally
  register itself twice under its own composition-root key (JS object
  keys are unique).
- **Completion tracking:** `ProcessedEventStore.hasProcessed(consumer,
eventId)` already answers "has this module finished purging for this
  specific purge event" — no new schema, no new table. A future
  operational tool that wants to know "has organization X's purge fully
  completed across every registered module" can call `hasProcessed` once
  per registered module's `${module}:purge` consumer name against the
  known purge event id.

`registerPurgeHandler`'s only actual job is composing these three
already-shipped pieces correctly for the purge-specific shape: deriving
the consumer name, subscribing to the right event, and extracting
`organizationId` off the event envelope (`DomainEvent.organizationId`,
not a payload field — org scope is envelope-level per kernel's event
design) before handing it to the module's own handler.

## Failure modes

| Failure                                                                    | Behavior                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organization.purge_requested` event delivered with `organizationId: null` | Throws `ValidationError` before the module's own handler is ever called — a null-org purge request is a producer bug, not a case the module should have to defend against |
| The module's own `PurgeHandler` throws                                     | Per `idempotentHandler`'s contract: the event stays unmarked, so redelivery retries it — same behavior every other idempotent consumer in this codebase already has       |
| The same purge event redelivered after a successful purge                  | No-op — `idempotentHandler`'s dedup check short-circuits before the module's handler runs again                                                                           |
| Two modules register with the same module name                             | Structurally impossible via `createCoreStack`'s `modules: Record<string, ModuleInstance>` (object keys are unique) — not this component's job to re-guard against         |

## Retry / timeout / cancellation

None at this layer — inherited entirely from `idempotentHandler` and the
outbox relay's own retry/redelivery posture (E03-T12). This component adds
no new timing behavior.

## Concurrency guarantees

Whatever `ProcessedEventStore` implementation is supplied provides them.
`PostgresProcessedEventStore`'s `ON CONFLICT (consumer, event_id) DO
NOTHING` (E03-T14) makes concurrent redelivery attempts of the same event
safe — the row is written exactly once regardless of how many callers
race to mark it.

## Performance

Adds one `hasProcessed` check before the module's handler runs, and one
`markProcessed` write after it succeeds — the same two-query cost every
other `idempotentHandler`-wrapped consumer already pays. Not separately
benchmarked (pending E04-T13, same posture as every other platform
component).

## Security considerations

`organizationId` comes from the event envelope, populated by
`createEvent` from a server-resolved `Context` (E03-T32) — never
re-derived from payload data a handler might trust incorrectly. A module's
own `PurgeHandler` is trusted first-party (or reviewed third-party, per
Architecture §24) code; this component does not sandbox or validate what
a handler does with the organization id beyond confirming it's non-null.

## Observability

None added directly — matches this package's posture toward every other
pure composition/orchestration component. `ProcessedEventStore.hasProcessed`
is available to any caller (ops tooling, a future admin endpoint) that
wants to check a specific module's completion status for a specific purge
event, without this component needing to expose a dedicated query
surface of its own.

## Testing

**7 pure unit tests** (`test/application/purge-protocol.test.ts`,
`InMemoryProcessedEventStore`): consumer-namespacing, module-name
validation, the null-organizationId rejection (and that the module's
handler is never called in that case), correct `organizationId` handoff,
idempotency across a same-event redelivery, unmarked-and-retryable on
handler failure, and independent consumer namespaces for two different
modules.

**2 real-Postgres integration tests**
(`test/integration/purge-protocol.postgres.test.ts`), matching the
blueprint's exact acceptance criterion — "Fixture module's purge handler
invoked exactly once, idempotent on replay": the fixture module's purge
logic runs exactly once across three deliveries of the identical event,
durably (via `PostgresProcessedEventStore`, not an in-memory fake); and a
failed first attempt stays unmarked and is genuinely retried on
redelivery, succeeding the second time.

## Design rationale

Why is this framed as composition rather than a new
`PurgeHandlerRegistry` type with its own registration/lookup API? Every
piece of machinery this protocol needs — dedup, retry, boot-time
duplicate detection — already exists and is already tested. A new
registry would either duplicate that machinery (two dedup mechanisms to
keep in sync) or wrap it in an abstraction that hides which already-proven
component is actually doing the work. `registerPurgeHandler` stays a thin
function precisely so a reader can trace exactly which E02/E03 task each
guarantee comes from.

Why derive `consumer` as `${moduleName}:purge` rather than accepting an
explicit consumer name parameter? A module author choosing their own
consumer name is one more way to accidentally collide with another
module's consumer for an unrelated event (the checkpoint/idempotency
identity kernel's `EventSubscription.consumer` doc calls out). Deriving it
from the already-validated, already-unique module name removes that
degree of freedom entirely — there's nothing to get wrong.
