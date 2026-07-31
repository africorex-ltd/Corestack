# E05-T14 — Tenancy Invitation-Notification Orchestration: Completion Report

- **Date:** 2026-07-31
- **Scope:** founder directive "Begin E05-T14 only. Do not implement real
  email delivery, external providers, queues outside the platform
  infrastructure, or background schedulers." Sections 1–14.
- **Verdict:** **Complete** — invitation events now produce durable,
  replay-safe notification work items; no email is sent, and no request
  path in `@corestack/tenancy` depends on this table.

## What shipped

`packages/tenancy/src/application/notification-work-item.ts` (the
`NotificationWorkItem` model, Section 4's field list exactly),
`build-notification-work-item.ts` (`buildNotificationWorkItemFromEvent` —
pure, zero-I/O event→work-item mapping),
`notification-work-item-repository.ts` (the persistence port);
`src/infrastructure/postgres/postgres-notification-work-item-repository.ts`
(the Postgres adapter) and `invitation-notification-consumer.ts`
(`createInvitationNotificationSubscription` — the `EventSubscription` that
wires the pure mapper to the adapter behind one idempotent,
transactionally-atomic handler); migration
`migrations/tenancy/0003_create-notification-work-items.sql`; two new
`ensureTenancyModuleRoles` grants (`tenancy_platform` gains `platform`
schema `USAGE` and `SELECT, INSERT` on `platform.processed_events`); new
[ADR-0026](../adr/0026-notification-work-item-repository-is-global.md).

Full design writeup:
[docs/modules/tenancy-notification-orchestration.md](../modules/tenancy-notification-orchestration.md)
(event flow, the single-wildcard-subscription rationale, idempotency/
atomicity/role-elevation strategy, retry-state model, why no email is
sent yet, future delivery adapters, grants).

**Tests:** 16 new unit tests (`build-notification-work-item.test.ts`: 7
tests covering pure mapping, including the `MEMBER_JOINED`/unrecognized-
event/null-organizationId exclusions and injected `clock`/`ids` usage;
`invitation-notification-consumer.test.ts`: 2 tests covering subscription
shape and the ignored-event no-transaction-opened property;
`migration-notification-work-items-consistency.test.ts`: 7 tests
verifying the shipped migration against `buildOrgScopedTableRlsDdl`'s
real generator output byte-for-byte) and 7 new integration tests
appended to `test/integration/tenancy-postgres.postgres.test.ts`'s new
`"Invitation-notification consumer (E05-T14)"` describe block, run
against real PostgreSQL: `INVITATION_CREATED` → `PENDING` work item with
recipient, duplicate delivery → no duplicate row, `INVITATION_ACCEPTED`/
`INVITATION_EXPIRED` → null-recipient work items, replay safety,
transaction rollback safety, `MEMBER_JOINED` ignored end-to-end.

## The single-wildcard-subscription decision

The obvious first design — three `EventSubscription`s, one per handled
event name — has a hazard that nothing at composition time catches.
`EventSubscription.consumer` doubles as the outbox relay's checkpoint
identity (`OutboxRelayStore.getCheckpoint(consumer)`), keyed by consumer
name alone, not `(consumer, event)`. Three subscriptions sharing one
consumer name across three event names would each independently read and
advance the *same* checkpoint row — exactly the corruption
`create-core-stack.ts`'s duplicate-registration check calls out by name,
but that check only catches an *identical* `(consumer, event)` pair, not
three distinct event names sharing a consumer. It would only ever surface
as silently-wrong checkpoint advancement in production, not a composition-
time error.

The chosen design instead registers one subscription
(`event: "*"`), filtering internally against a `HANDLED_EVENT_NAMES` set.
One checkpoint, no ambiguity — at the accepted cost that this consumer's
checkpoint advances across every event in the outbox, not only the three
it acts on.

## A real bug this task's own integration tests caught

The first working version of `invitation-notification-consumer.ts`
elevated to `tenancy_platform` only around the repository's own `INSERT`
— mirroring `PostgresOrganizationRepository.existsBySlug`/`findBySlug`'s
elevate-then-`RESET ROLE` pattern too literally. That left the
`ProcessedEventStore.hasProcessed`/`markProcessed` calls against
`platform.processed_events` running as the unprivileged `tenancy_app`
role. Running the real-Postgres integration suite surfaced this
immediately: 5 of 7 new tests failed with `PostgresError: permission
denied for table processed_events`, pointing straight at
`PostgresProcessedEventStore.hasProcessed`.

The fix moved `SET LOCAL ROLE tenancy_platform` to the very first
statement inside the consumer's own transaction — before the
`hasProcessed` check, not just before the insert — and removed all
role-elevation logic from the repository's `create` method entirely (it
now relies on the surrounding transaction already being elevated, and
never resets mid-transaction, unlike `existsBySlug`/`findBySlug`, whose
surrounding transaction keeps running as `tenancy_app` afterward for
other calls). Reran the integration suite twice consecutively — 41/41
passing both times — before moving on.

This is also why the transaction-rollback-safety test asserts a specific
expected error (`rejects.toThrow(/invalid input syntax/i)`) rather than a
bare `.toThrow()`: a bare assertion would have passed even during the
buggy version above, since a permission-denied error is still a thrown
error. Tightening it to the specific expected failure reason is what
makes the test actually verify rollback safety rather than "something,
anything, throws" — a direct, self-directed correction made in response
to having just been burned by exactly that class of false-positive risk.

## Atomicity via a hand-rolled transaction, not the kernel's `idempotentHandler`

The kernel's generic `idempotentHandler` wrapper (`processed-events.ts`)
calls `hasProcessed`, the handler, and `markProcessed` as three separate
steps — sufficient for at-least-once dedup, not sufficient for Section
8's "transaction rollback safety": the work-item insert and the
processed-mark must commit or roll back together, or a crash between
steps would leave a row inserted but the event unmarked, guaranteeing a
duplicate on redelivery. The handler instead opens its own
`PostgresUnitOfWork` transaction and sequences `hasProcessed` → build
(pure) → insert → `markProcessed` by hand, all against the one open
transaction — exactly the atomicity `PostgresProcessedEventStore`'s own
doc comment describes as possible "when the caller explicitly wires it
this way."

## An architecture-fitness failure caught only by the full repo-wide gate

`cd packages/tenancy && npx tsc/vitest` runs stayed green throughout —
the violation was invisible there, because `architecture-tests` is a
separate package. It was caught only because this task's own Section 11
quality gate ends with a full `npx turbo run build typecheck test --force`
across the whole monorepo, not just the package being modified.
`checkRepositoryOrgScoping` (`packages/architecture-tests/test/
tenant-isolation.test.mjs`) flagged `postgres-notification-work-item-repository.ts`
(matches the `*repository*.ts` glob) for referencing neither
`OrgScopedContext` nor `GlobalRepository` — ADR-0021's mandatory rule for
every real repository file.

The fix: [ADR-0026](../adr/0026-notification-work-item-repository-is-global.md)
justifies this repository as `@corestack/tenancy`'s first real
`GlobalRepository` — its only caller is a replayed domain event, not an
authenticated request, so there's no per-call `OrgScopedContext`/
`app.current_org` to reference; visibility comes entirely from the
elevated `tenancy_platform` role's RLS bypass instead. The class now
`implements NotificationWorkItemRepository, GlobalRepository` with
`readonly __globalRepository = true as const`. Reran the fitness suite —
8/8 passing (up from 7/8) — then the full repo-wide gate — 14/14 tasks
green, tenancy at 466 unit tests across 40 files (up from 450/37).

## A follow-up advisor pass, before commit

A second advisor review of the shipped design flagged one real issue and
one worth documenting rather than fixing:

- **ADR-0026 misdescribed a fitness-rule pass as a design property.** The
  ADR originally stated that the application-layer port
  (`notification-work-item-repository.ts`) "already mentions
  `OrgScopedContext` in prose... which satisfies the fitness rule's text
  match on that file already" — true today, but stated as if it were
  intentional, when it is actually an accident of wording: the fitness
  rule is a blunt regex, and a future editor tidying that doc comment
  and dropping the `OrgScopedContext` mention would break CI on an
  application-layer interface that has nothing to do with org scoping.
  Fixed by rewriting the ADR paragraph to state this honestly as a known
  fragility (with the correct response spelled out: restore some literal
  mention, or add the `GlobalRepository` marker to the port too — not
  weaken the rule, and not conclude the port needs real scoping logic it
  never had), and adding a matching code comment directly in
  `notification-work-item-repository.ts` so a future editor sees the
  warning at the point of the accidental dependency, not only in an ADR
  they may not read.
- **The migration's `attempts integer NOT NULL DEFAULT 0` was redundant**
  — the only writer (`PostgresNotificationWorkItemRepository.create`)
  always supplies `attempts` explicitly from the model, so the `DEFAULT`
  would never fire. Dropped it (`attempts integer NOT NULL`, no default),
  matching the same "no fallback for a case that can't happen"
  discipline as this task's recipient-nullability choice, and updated the
  migration-consistency test and its own explanatory comment to match.
  Reran the consistency test (7/7), the integration suite (41/41, twice),
  and `tsc --noEmit` (clean) after both fixes.

## Work-item model highlights

`recipient` is nullable, not `?? ""`-coerced: `INVITATION_CREATED` always
carries a real email; `INVITATION_ACCEPTED`/`INVITATION_EXPIRED`
payloads carry no email field at all (by design since E05-T07), and
Section 5 forbids the repository read that resolving one would require
— the same nullable-not-masked discipline E05-T13 established correcting
`context.actor.id ?? ""`. All four `NotificationWorkItemStatus` values
(`PENDING`/`PROCESSING`/`PROCESSED`/`FAILED`) exist from day one even
though this task's own handler only ever produces `PENDING` — the CHECK
constraint is complete now; the other three are transitions a
not-yet-built delivery worker will make.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` (via `turbo run build typecheck`)
  — 14/14 tasks pass.
- `eslint packages/tenancy packages/architecture-tests` — zero findings.
- `pnpm -r test` (via `turbo run test`) — 14/14 tasks pass, including
  tenancy's full 466-test unit suite across 40 files (up from 450/37).
- `pnpm --filter @corestack/tenancy test:integration` — 41/41 tests pass
  (up from 34) against a real local PostgreSQL 18 instance, run twice to
  confirm stability, including after the `GlobalRepository`/migration
  fixes above.
- Architecture-fitness suite — 36/36 across 5 files, unchanged in count;
  the tenant-isolation file's own subset is 8/8 (up from 7/8 mid-task,
  before the `GlobalRepository` fix).
- Export-surface snapshot — re-verified green; no new exported symbols
  from the `GlobalRepository` interface addition (only a new implemented
  interface + a readonly property on an already-exported class), so the
  existing snapshot (updated once, for the new
  `INVITATION_NOTIFICATION_CONSUMER`/`PostgresNotificationWorkItemRepository`/
  `createInvitationNotificationSubscription`/`toNotificationWorkItem`/
  `toNotificationWorkItemRow`/`buildNotificationWorkItemFromEvent`
  exports) remains valid.

## Permanent policy reaffirmed (Section 10)

Events create work; handlers perform no I/O; delivery is a separate
concern; idempotency is mandatory; retries are state, not timers — all
five describe exactly what this task built, not aspirations.

## What's still open, not resolved here

- **Real email delivery, external providers, any scheduler or worker
  process** — explicitly out of scope per Section 13. `PENDING` rows
  have no reader yet.
- **Wiring `createInvitationNotificationSubscription` into
  `createTenancyModule`'s `eventHandlers`** — deliberately not done, the
  same deferred-wiring cut E05-T13 made for `tenancyRoutes`.
  `module.test.ts`'s existing `eventHandlers` `toHaveLength(1)` assertion
  (the pre-existing purge subscription) is the concrete proof this is
  deliberate, not an oversight.
- **The `tenancy_app` RLS policies/grant on `notification_work_items`**
  remain unused by any current caller, kept only for forward-compatibility
  with a possible future request-scoped read — documented explicitly as
  deliberately unused in both the migration comment and the design doc,
  not evidence a request path exists.
- **Release-pipeline debt** (recurring, tracked across every prior report
  in this sequence): `@corestack/tenancy` remains `0.0.1`, no changeset —
  this task adds new exported surface to `./postgres`; still not cut into
  a release.

## Next

**E05-T15**: not yet specified by the founder directive sequence. Not
started. Per Section 14, work stops here pending the next prompt — no
real notification delivery, background worker, or module-scaffold wiring
started automatically.
