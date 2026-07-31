# E05-T15 — Tenancy Notification Processing Service: Completion Report

- **Date:** 2026-07-31
- **Scope:** founder directive "Begin E05-T15 only. Do not integrate
  SendGrid, SES, Postmark, SMTP, or any external provider." Sections
  1–14.
- **Verdict:** **Complete** — durable work can be claimed, processed, and
  retried safely; delivery is fully abstracted behind
  `NotificationDeliveryPort`; no request path or scheduler depends on
  real email.

## What shipped

`packages/tenancy/src/application/notification-delivery-port.ts`
(`NotificationDeliveryPort` + `NotificationDeliveryPermanentError`),
`notification-processing-decisions.ts`
(`decideNotificationFailureOutcome`/`assertNotificationWorkItemDeliverable`
— pure, zero-I/O); three new `NotificationWorkItemRepository` methods
(`claimNextPending`/`markProcessed`/`markFailed`), implemented in
`PostgresNotificationWorkItemRepository`;
`src/infrastructure/postgres/process-notification-work-item.ts`
(`processNextNotificationWorkItem` — the one exported entry point);
`test-support/recording-notification-delivery-adapter.ts` (the test
delivery adapter); migration
`migrations/tenancy/0004_grant-tenancy-platform-update-notification-work-items.sql`.

Full design writeup:
[docs/modules/tenancy-notification-processing.md](../modules/tenancy-notification-processing.md)
(claim lifecycle, the two-transaction rationale, `SKIP LOCKED` mechanics,
retry/failure-category semantics, worker model, future provider
integration).

**Tests:** 13 new unit tests (11 pure retry/validation-decision tests in
`test/application/notification-processing-decisions.test.ts`, 2
grant-migration consistency tests) and 8 new integration tests appended
to `test/integration/tenancy-postgres.postgres.test.ts`'s new
`"Notification processing service (E05-T15)"` describe block, run
against real PostgreSQL: successful processing, no-pending-work, replay
prevented, two `SKIP LOCKED` concurrency tests, transient-failure retry,
repeated-failure-to-terminal-`FAILED`, and a permanently malformed item
failing immediately.

## Two transactions, not one — and why

`processNextNotificationWorkItem` claims a row in one
`PostgresUnitOfWork` transaction, then dispatches to the delivery port
with **no transaction open at all**, then records the outcome in a
second transaction. Section 10's own permanent policy states "work is
claimed before delivery" and "delivery side effects happen after claim"
as two distinct bullets — the concrete reason beyond following the
letter of that policy: holding a database transaction open across an I/O
call to an external provider (today: an in-memory test double;
eventually: a real network call of unpredictable duration) would hold a
connection and a row lock for however long that call takes, turning a
slow or hung provider into a database problem too.

## A real gap this task's own integration tests caught: the missing UPDATE grant

E05-T14's migration granted `tenancy_platform` only `SELECT`/`INSERT` on
`notification_work_items`, sized exactly for that task's one writer (an
`INSERT`-only event consumer). Running this task's own integration suite
for the first time failed every new test immediately with `PostgresError:
permission denied for table notification_work_items`, from
`claimNextPending`'s own `UPDATE` statement. The fix — migration
`0004_grant-tenancy-platform-update-notification-work-items.sql`, a
single additive `GRANT UPDATE ...` — is a **new** migration, not an edit
to the already-shipped 0003: migrations are immutable once shipped, and
the correct response to a missing grant discovered later is always
another `GRANT`, never a rewrite of history. This is the same class of
finding as E05-T14's own role-elevation bug — caught by running the
actual integration suite against real Postgres, not by review.

## A structural gap found by the advisor, before the concurrency tests were trusted

Before finalizing, an advisor review flagged that the first draft of the
two `SKIP LOCKED` concurrency tests raced two bare
`processNextNotificationWorkItem` calls via `Promise.all` with no forced
overlap — a test shape that can pass even if `SKIP LOCKED` were silently
removed from the query, since nothing guarantees the two claims'
underlying `SELECT` statements ever genuinely execute while the other's
lock is held. Verified directly: temporarily removing `SKIP LOCKED` and
re-running just those two tests made both **time out** rather than fail
cleanly — proof the original tests would have passed for the wrong
reason. Both tests were rewritten to hold one claim's transaction open
past its own commit via an explicit gate (a `Promise` the test resolves
only after asserting on the second, concurrent claim), which forces
genuine overlap — the second claim can only be awaited (and the test can
only proceed) while the first transaction's row lock is provably still
live. Restored `SKIP LOCKED`, reran the falsified tests (now passing),
then the full suite twice for stability.

The same advisor pass also identified — and this task fixed —
`markProcessed`/`markFailed` filtering only on `id`, not also
`WHERE status = 'PROCESSING'`. Added the guard: cheap, and it makes the
claim -> mark handshake self-enforcing at the database rather than
merely correct-in-practice-today.

## A known, accepted gap, documented rather than fixed

A worker running `processNextNotificationWorkItem` that crashes, loses
its connection, or is killed **between the claim transaction committing
and the mark transaction running** — most likely during the delivery
call itself — leaves that row in `PROCESSING` forever.
`claimNextPending`'s `WHERE status = 'PENDING'` filter means nothing will
ever reclaim it; it is not `FAILED` (Section 4's "failed rows are not
lost" guarantee covers rows this processor itself decided to fail, not
rows abandoned mid-flight), not `PROCESSED`, and not retryable by
anything shipped in this task.

This is not an oversight silently left untested — it is the direct,
understood cost of the two-transaction design, which is otherwise the
right choice (see above), and it is written into the design doc's
"worker model" section rather than fixed here, because closing it
properly requires exactly the reaper/timer/heartbeat mechanism Section
13 explicitly forbids building in this task ("do not add polling loops.
do not add timers. do not add background daemons"). Two concrete options
for a future task that adds real background processing are recorded in
the design doc: a `claimedAt` column plus a staleness sweep, or a
heartbeat with the same kind of sweep. Building either now, with no
scheduler to drive it, would be exactly the unused-surface mistake this
codebase's own prior tasks have repeatedly caught and removed.

## Failure categories (Section 7)

Two categories, decided by the pure `decideNotificationFailureOutcome`:

- **Transient** (any ordinary thrown error): `attempts` increments;
  returns to `PENDING` while `attempts < MAX_NOTIFICATION_DELIVERY_ATTEMPTS`
  (Section 4: "retries remain visible"), else resolves to terminal
  `FAILED` (Section 4: "failed rows are not lost").
- **Permanent** (`NotificationDeliveryPermanentError` — an unrecognized
  `type`, or an `INVITATION_CREATED` item with a `null` recipient):
  resolves to `FAILED` immediately, regardless of remaining attempts,
  since retrying can never fix either condition.

Both permanent-failure conditions are currently unreachable through the
normal write path (one of them — an unrecognized `type` — is unreachable
through the database at all, blocked by E05-T14's own `CHECK`
constraint), and this is documented explicitly as intentional defense
against a future fourth type or a hand-crafted row, not dead code: the
design doc states plainly why the check exists despite having no live
trigger today.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` (via `turbo run build typecheck`)
  — 14/14 tasks pass.
- `eslint packages/tenancy packages/architecture-tests` — zero findings.
- `pnpm -r test` (via `turbo run test`) — 14/14 tasks pass, including
  tenancy's full 479-test unit suite across 42 files (up from 466/40).
- `pnpm --filter @corestack/tenancy test:integration` — 49/49 tests pass
  (up from 41) against a real local PostgreSQL 18 instance, run twice to
  confirm stability, including after the `WHERE status = 'PROCESSING'`
  guard and the concurrency-test rewrite.
- Architecture-fitness suite — 36/36 across 5 files, unchanged (the new
  repository methods live on an already-`GlobalRepository`-marked class;
  no new fitness-relevant surface).
- Export-surface snapshot — updated for the new
  `processNextNotificationWorkItem`/`NotificationProcessingDeps`/
  `NotificationProcessingResult` (`./postgres`) and
  `MAX_NOTIFICATION_DELIVERY_ATTEMPTS`/`NotificationDeliveryPermanentError`/
  `assertNotificationWorkItemDeliverable`/`decideNotificationFailureOutcome`
  (main entry) exports; re-verified green after all subsequent code
  changes.

## Permanent policy reaffirmed (Section 10)

Work is claimed before delivery; delivery side effects happen after
claim; success is explicit; failure is durable; retries are observable —
all five describe exactly what this task built.

## What's still open, not resolved here

- **Real email delivery, any external provider integration.** Explicitly
  out of scope per this task's own directive — `NotificationDeliveryPort`
  has exactly one implementation anywhere in this codebase, the
  in-memory test adapter.
- **Any worker, scheduler, cron job, or polling loop** that repeatedly
  calls `processNextNotificationWorkItem`. Section 13 forbids building
  one in this task; nothing does.
- **The crashed-worker `PROCESSING`-orphan gap**, documented above and in
  the design doc — deliberately not closed here, since closing it needs
  the scheduler this task is explicitly told not to build.
- **`MAX_NOTIFICATION_DELIVERY_ATTEMPTS` is not configurable.** A plain
  exported constant, not a `tenancyConfigSpec` field — Section 7 doesn't
  ask for it to be tunable, and adding a config field nobody asked for
  would be scope creep.
- **Release-pipeline debt** (recurring, tracked across every prior report
  in this sequence): `@corestack/tenancy` remains `0.0.1`, no
  changeset — this task adds new exported surface to `./postgres`; still
  not cut into a release.

## Next

**E05-T16**: not yet specified by the founder directive sequence. Not
started. Per Section 14, work stops here pending the next prompt — no
real email integration started automatically.
