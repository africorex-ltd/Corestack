# Tenancy Notification Orchestration (E05-T14)

- **Status:** durable, replay-safe background processing for invitation
  notifications — domain events become persisted work items. No email is
  sent, no external provider is integrated, no scheduler or worker
  process exists yet (Section 13 of the founder directive: "Do not
  integrate SendGrid, SES, Postmark, SMTP, or any external service. Do
  not add cron jobs. Do not add worker processes.").
- **Scope:** `packages/tenancy/src/application/notification-work-item.ts`
  (model), `build-notification-work-item.ts` (pure event → work-item
  mapping), `notification-work-item-repository.ts` (port);
  `src/infrastructure/postgres/postgres-notification-work-item-repository.ts`
  (adapter), `invitation-notification-consumer.ts` (the event
  subscription that ties the two together); migration
  `migrations/tenancy/0003_create-notification-work-items.sql`.
- **Builds on:** the kernel's `EventBus`/`ProcessedEventStore`/
  `UnitOfWork` ports and `packages/platform`'s Postgres adapters for
  them (`PostgresUnitOfWork`, `PostgresProcessedEventStore`), plus
  `PostgresOutboxRelay`'s existing checkpoint-per-consumer model — all
  pre-existing infrastructure this task wires into, not new
  infrastructure it builds.

## Event flow

```
INVITATION_CREATED / INVITATION_ACCEPTED / INVITATION_EXPIRED
        |  (published to the transactional outbox by the use case
        |   that raised the event — E05-T05/T06/T07, unchanged)
        v
  OutboxRelay delivers to every registered EventSubscription
        v
  createInvitationNotificationSubscription's handler
    1. skip if event.name isn't one of the three handled names
    2. open one PostgresUnitOfWork transaction (organizationId: null)
    3. SET LOCAL ROLE tenancy_platform  (first statement, whole tx)
    4. hasProcessed(consumer, event.id)? -> if yes, return (no-op)
    5. buildNotificationWorkItemFromEvent(event, {ids, clock})  (pure)
    6. if the result isn't null, repository.create(tx, item)
    7. markProcessed(consumer, event.id)
        v
  tenancy.notification_work_items row, status = PENDING
        v
  (nothing reads this table yet — see "Why no email is sent yet")
```

`MEMBER_JOINED` is ignored per Section 3 — the handler's
`HANDLED_EVENT_NAMES` set simply doesn't contain it, so it's skipped at
step 1 before any transaction opens (asserted directly in
`invitation-notification-consumer.test.ts` via a fake `Sql` whose
`.begin` throws if called).

## A single wildcard subscription, not three

`createInvitationNotificationSubscription` returns exactly one
`EventSubscription` — `{ consumer: "tenancy:invitation-notifications",
event: "*", handler }` — not three subscriptions filtered by event name.

The reason is `OutboxRelayStore.getCheckpoint(consumer)`: the relay's
checkpoint is keyed by **consumer name alone**, not `(consumer, event)`.
Three subscriptions sharing one consumer name across three different
event names would each independently read and advance the *same*
checkpoint row — the exact corruption `create-core-stack.ts`'s
duplicate-registration check calls out by name ("this would corrupt
outbox checkpoint tracking"). That check only catches an *identical*
`(consumer, event)` pair; it does not catch three distinct event names
sharing one consumer, so nothing flags this hazard at composition time —
it would only surface as silently-wrong checkpoint advancement in
production.

One subscription with `event: "*"`, filtering internally against
`HANDLED_EVENT_NAMES`, has exactly one checkpoint. Accepted consequence:
this consumer's checkpoint advances across *every* event in the outbox,
not just the three it acts on — correct at today's event volume, and
simpler than teaching the relay a compound checkpoint key for a
three-event consumer.

## Idempotency strategy

Two independent layers, both required:

1. **`buildNotificationWorkItemFromEvent` is pure and total** — same
   `DomainEvent` in, same `NotificationWorkItem | null` out, no I/O. This
   makes "replay produces the same work item" a property you can assert
   without touching Postgres (`build-notification-work-item.test.ts`).
2. **`PostgresProcessedEventStore` dedups per `(consumer, event.id)`.**
   The handler checks `hasProcessed` before doing any work and calls
   `markProcessed` after — inside the *same* transaction as the
   work-item insert (see next section), so a duplicate delivery of the
   same event is a guaranteed no-op, not a best-effort one.

Both layers matter: without (1), two different work items could be
built for logically-identical replays (e.g. if `buildNotificationWorkItemFromEvent`
read wall-clock time or generated its own id internally rather than
taking `clock`/`ids` as injected dependencies). Without (2), every
redelivery — which the outbox relay's at-least-once semantics guarantee
will eventually happen — would insert a second row.

## Atomicity: a hand-rolled transaction, not `idempotentHandler`

The kernel ships a generic `idempotentHandler` wrapper
(`processed-events.ts`) that calls `hasProcessed`, the handler, and
`markProcessed` as three separate steps. That's sufficient for
at-least-once dedup, but not for what Section 8 actually asks for:
"transaction rollback safety" — the work-item insert and the
processed-mark must commit or roll back **together**. Three separate
steps can't guarantee that; a crash between step 2 and step 3 would
leave a row inserted but the event unmarked, so a redelivery would
insert a second row anyway.

The handler instead opens its own `PostgresUnitOfWork` transaction and
sequences `hasProcessed` → build (pure, no I/O) → `repository.create` →
`markProcessed` by hand, all against the one open transaction — matching
what `PostgresProcessedEventStore`'s own doc comment describes as
possible "when the caller explicitly wires it this way." The integration
test proving this (`tenancy-postgres.postgres.test.ts`, "transaction
rollback safety") forces a real Postgres error (a malformed UUID) inside
the transaction and asserts the whole thing rolls back — no partial
work-item row, no partial processed-event mark — via
`rejects.toThrow(/invalid input syntax/i)`, deliberately not a bare
`.toThrow()` (see "A bug this task's own tests caught" below for why
that specificity matters).

## Role elevation, not `app.current_org`

`PostgresUnitOfWork` is constructed with `organizationId: null` — this
consumer isn't scoped to any one organization's request, so there's
nothing to set `app.current_org` to. Visibility instead comes from
`SET LOCAL ROLE tenancy_platform`, issued **once, as the first statement
in the transaction** — before the `hasProcessed` check, not just before
the work-item insert.

Both `platform.processed_events` and `tenancy.notification_work_items`
grant only `tenancy_platform`, never `tenancy_app` (for the insert
path — see "Grants" below for the unrelated `tenancy_app` read grant).
Unlike `PostgresOrganizationRepository.existsBySlug`/`findBySlug`, which
elevate and immediately `RESET ROLE` because their surrounding
transaction keeps running as `tenancy_app` afterward for other calls,
this transaction never resets: everything after the first statement, for
the rest of this one handler-owned transaction, needs to stay elevated.

### A bug this task's own tests caught

The first version of this design elevated only around the repository's
own `INSERT` (mirroring `existsBySlug`/`findBySlug` too literally),
leaving `hasProcessed`/`markProcessed` running as the unprivileged
`tenancy_app` role. Running the real-Postgres integration suite
surfaced this immediately: 5 of 7 new tests failed with
`PostgresError: permission denied for table processed_events`, pointing
straight at `PostgresProcessedEventStore.hasProcessed`. The fix moved
elevation to the top of the transaction and removed all role-elevation
logic from the repository's own `create` method (it now runs as a plain,
unelevated-at-its-own-level `INSERT` that relies on the surrounding
transaction already being elevated).

This is the reason the rollback-safety test asserts a specific error
message (`/invalid input syntax/i`) rather than a bare `.toThrow()`: a
bare `.toThrow()` would have passed even during the buggy version above
— a permission-denied error is still a thrown error — so it would not
have caught a real regression back to that bug. Asserting the *specific*
expected failure reason is what makes the test actually verify rollback
safety rather than "something, anything, throws."

## Work-item model (Section 4)

```ts
interface NotificationWorkItem {
  readonly id: string;
  readonly type: "INVITATION_CREATED" | "INVITATION_ACCEPTED" | "INVITATION_EXPIRED";
  readonly organizationId: string;
  readonly invitationId: string;
  readonly recipient: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED";
  readonly attempts: number;
  readonly createdAt: Date;
  readonly processedAt: Date | null;
  readonly lastError: string | null;
}
```

**`recipient` is nullable, not `?? ""`-coerced.** `INVITATION_CREATED`
always carries a real email (`InvitationCreatedPayload.email`).
`INVITATION_ACCEPTED`/`INVITATION_EXPIRED` payloads carry no email field
at all (by design since E05-T07), and Section 5 forbids the handler from
doing I/O — a repository read to resolve one would violate that — so
those two produce `recipient: null`. This is the same nullable-not-masked
discipline E05-T13 corrected `context.actor.id ?? ""` to establish;
`recipient` never repeats that mistake here.

**All four `NotificationWorkItemStatus` values exist from day one** even
though this task's own handler only ever produces `PENDING`. The CHECK
constraint is complete now; `PROCESSING`/`PROCESSED`/`FAILED` are
transitions a not-yet-built delivery worker will make (Section 7: "do
not implement a scheduler" — the states exist, nothing drives them yet).

## Retry strategy (Section 7)

This task implements **state, not timers.** `attempts`, `status`,
`processedAt`, and `lastError` are columns a future delivery worker will
read and update; nothing in this task schedules, delays, or retries
anything. The migration's `attempts` column has no `DEFAULT` — the only
writer (`PostgresNotificationWorkItemRepository.create`) always supplies
it explicitly from the model (`0` for a freshly built item), so a
default would never fire. This mirrors the recipient-nullability choice
above: no fallback for a case that structurally can't happen.

## Why no email is sent yet

Section 1's own framing: this task is "the durable background-processing
side of invitation notifications without integrating any external email
service." Concretely, that means:

- No SendGrid/SES/Postmark/SMTP client exists anywhere in this module or
  package (Section 13, verified by not adding one).
- No process reads `PENDING` rows and attempts delivery — the table is
  write-only from this task's perspective. `NotificationWorkItemRepository`
  deliberately has no `findById`/list method (Section 8's integration
  tests verify a created row directly against the table instead, the
  same pattern the existing suite already uses for soft-deleted rows).
- No request path in `@corestack/tenancy` depends on this table at all
  — `inviteMember`/`acceptInvitation`/expiry logic (E05-T05–T07) are
  entirely unchanged by this task. A future delivery worker failing,
  stalling, or not existing yet has zero effect on any use case's
  correctness or latency (Section 12's expected outcome: "no request
  path depends on email").

## Future delivery adapters

Nothing in this task's shape blocks a future delivery worker; the
opposite — it's the reason for this shape. A worker would, on its own
schedule (a poller, a queue consumer, whatever E14's eventual
`@corestack/http`/worker toolkit provides):

1. Select `PENDING` rows (`tenancy_platform`'s existing `SELECT` grant
   already covers this — see "Grants" below).
2. Transition to `PROCESSING`, attempt delivery through whichever
   provider adapter is chosen then (SendGrid, SES, Postmark, SMTP, or
   anything else — genuinely undetermined by this task, deliberately).
3. Transition to `PROCESSED` (success) or `FAILED` with `lastError` set
   and `attempts` incremented (failure), for a retry policy that worker
   defines — not this task.

Nothing here needs a schema migration or a workflow change to add later;
that's Section 12's "delivery can be added later without changing
workflows" made concrete.

## Not wired into the module scaffold

`createInvitationNotificationSubscription` is built and exported from
`src/postgres/index.ts`, but **not registered into `createTenancyModule`'s
`eventHandlers` array by this task.** This mirrors E05-T13's identical
cut for `tenancyRoutes` (built and exported, never auto-registered into
the module factory) — a composition root wires
`createInvitationNotificationSubscription`'s result into an `EventBus`/
`OutboxRelay` explicitly, the same way it would wire in HTTP routes,
rather than the module factory doing so implicitly. `module.test.ts`
already asserts `createTenancyModule(...).eventHandlers` has
`toHaveLength(1)` — the pre-existing purge subscription
(`tenancy:purge`, E05-T01) — which is the concrete proof this cut is
deliberate, not an oversight: that assertion would fail the moment this
task's subscription were added to the array without a corresponding test
update.

## Grants

`tenancy.notification_work_items` grants `tenancy_app` the standard
`SELECT`/`INSERT`/`UPDATE` set (never `DELETE`, matching every other
tenancy table) even though no code calls this table as `tenancy_app`
today — matching every other tenancy table's RLS policy set
unconditionally means a future "list my org's notification history" read
needs no RLS migration of its own, only a `GRANT` (already present) and a
repository method (not yet written). This grant is **deliberately
unused** by any current caller; it is not evidence a request path exists.

`tenancy_platform` gets `SELECT` and `INSERT` — `INSERT` because it's
the role the real writer (`invitation-notification-consumer.ts`) actually
runs as; `SELECT` so the future delivery worker described above can read
`PENDING` rows across every organization without a further grant.

## Testing

- **Unit** (`test/application/build-notification-work-item.test.ts`, 7
  tests): pure mapping — `INVITATION_CREATED` with a real recipient;
  `INVITATION_ACCEPTED`/`INVITATION_EXPIRED` with `recipient: null`;
  `MEMBER_JOINED` and unrecognized event names ignored; a
  `null`-`organizationId` event declined; injected `clock`/`ids` used
  (not `event.occurredAt` or an internally-generated id).
- **Unit** (`test/infrastructure/invitation-notification-consumer.test.ts`,
  2 tests): subscription shape (`consumer`, `event: "*"`, handler is a
  function); `MEMBER_JOINED` discarded without opening a transaction.
- **Unit** (`test/infrastructure/migration-notification-work-items-consistency.test.ts`,
  7 tests): the shipped migration matches `buildOrgScopedTableRlsDdl`'s
  real generator output byte-for-byte (whitespace-normalized), every
  Section 4 field and CHECK constraint is present, `DELETE` is never
  granted to `tenancy_app`, and the `tenancy_platform` grant
  (`SELECT, INSERT`) differs from every other tenancy table's
  `SELECT`-only precedent — asserted explicitly, not just present.
- **Integration** (`test/integration/tenancy-postgres.postgres.test.ts`,
  "Invitation-notification consumer (E05-T14)", 7 tests, real Postgres):
  `INVITATION_CREATED` → `PENDING` work item with recipient; duplicate
  delivery of the same event → no duplicate row; `INVITATION_ACCEPTED`/
  `INVITATION_EXPIRED` → null-recipient work items; replay safety (a
  fresh subscription instance still no-ops on an already-processed
  event); transaction rollback safety (see "A bug this task's own tests
  caught" above); `MEMBER_JOINED` ignored end-to-end.

Every event id used across these integration tests comes from a real
`UuidGenerator` (cryptographically random), not a sequential/fixed
generator — so no two tests can collide on the same
`(consumer, event.id)` dedup key and mask each other's assertions.

## Permanent policy reaffirmed (Section 10)

Adopted permanently, consistent with every prior E05 task's own
reaffirmations:

- **Events create work; handlers perform no I/O.**
  `buildNotificationWorkItemFromEvent` is pure — all I/O lives in the
  infrastructure-layer consumer that wraps it.
- **Delivery is a separate concern.** This table has no reader yet, by
  design; adding one is a future task, not a follow-up fix.
- **Idempotency is mandatory**, enforced structurally
  (`ProcessedEventStore`), not left to a reviewer to remember.
- **Retries are state, not timers.** `attempts`/`status`/`lastError`
  exist; no scheduler exists to drive them, and none should be added
  without a dedicated task.
