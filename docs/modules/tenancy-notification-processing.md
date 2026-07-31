# Tenancy Notification Processing Service (E05-T15)

- **Status:** proves the processing lifecycle — a claimed work item is
  reliably marked `PROCESSED` or `FAILED`, with retries tracked — without
  performing real delivery. No SendGrid/SES/Postmark/SMTP integration, no
  cron job, no worker process, no loop or scheduler exists anywhere in
  this package (Section 13).
- **Scope:** `packages/tenancy/src/application/notification-delivery-port.ts`
  (the delivery port + `NotificationDeliveryPermanentError`),
  `notification-processing-decisions.ts` (pure retry/validation logic),
  three new methods on `NotificationWorkItemRepository`
  (`claimNextPending`/`markProcessed`/`markFailed`);
  `src/infrastructure/postgres/process-notification-work-item.ts`
  (`processNextNotificationWorkItem` — the one exported entry point);
  `test-support/recording-notification-delivery-adapter.ts` (the test
  delivery adapter); migration
  `migrations/tenancy/0004_grant-tenancy-platform-update-notification-work-items.sql`.
- **Builds on:** [tenancy-notification-orchestration.md](tenancy-notification-orchestration.md)
  (E05-T14) — this task adds nothing to how work items are *created*;
  it only reads and transitions rows E05-T14's consumer already writes.

## Claim lifecycle

```
tenancy.notification_work_items (status = PENDING)
        |
        |  claimNextPending — one atomic UPDATE ... WHERE id = (SELECT
        |  ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *, inside its
        |  own PostgresUnitOfWork transaction, elevated to
        |  tenancy_platform. Commits immediately.
        v
   status = PROCESSING  (returned to the caller; no transaction open)
        |
        |  dispatch to the injected NotificationDeliveryPort — real I/O,
        |  no database transaction open during this call at all
        v
   success ------------------------------+------ failure
        |                                |
        v                                v
  markProcessed (own tx,      decideNotificationFailureOutcome (pure)
  elevated): status =                |
  PROCESSED, processedAt set,        v
  lastError cleared          markFailed (own tx, elevated):
                              status = PENDING (retry) or FAILED
                              (terminal), attempts incremented,
                              lastError set
```

`processNextNotificationWorkItem` is the one exported function. Every
invocation does exactly one claim-dispatch-record cycle: claim at most
one row, attempt delivery, record the outcome, return. Nothing loops,
polls, or schedules another cycle — whatever eventually calls this
function repeatedly (a cron job, a queue worker, a CLI command) is
explicitly out of scope for this task (Section 13).

## Why two transactions, not one

The claim and the outcome record are deliberately separate
`PostgresUnitOfWork` transactions, with the delivery call running under
no transaction at all in between. Section 10's permanent policy states
"work is claimed before delivery" and "delivery side effects happen
after claim" as two distinct bullets, and there's a concrete reason
beyond following the letter of that policy: holding a database
transaction open across an I/O call to an external delivery provider —
today the in-memory test adapter, eventually a real network call that
could take anywhere from milliseconds to several seconds — would hold a
connection and a row lock for however long that call takes. A slow or
hung provider would then also hold up whatever else needs that
connection pool slot or that row. Splitting into two short transactions
with the slow part in between means the database is never blocked on
external I/O.

Each of the two transactions elevates to `tenancy_platform`
independently — the same one-elevation-per-transaction shape
`invitation-notification-consumer.ts` (E05-T14) established, for the
same reason: this processor isn't scoped to any one organization's
request, so there's no `app.current_org` to set, and cross-tenant
visibility (claiming the oldest pending row *across every organization*,
not one) has to come from the platform role's RLS bypass instead.

## Claim semantics (Section 4)

The port's own doc comment (`notification-work-item-repository.ts`)
states four promises every adapter must honor, independent of mechanism:
one worker claims a row; claiming is a single atomic operation; retries
remain visible; failed rows are not lost. The Postgres adapter's
mechanism:

```sql
UPDATE tenancy.notification_work_items
SET status = 'PROCESSING'
WHERE id = (
  SELECT id FROM tenancy.notification_work_items
  WHERE status = 'PENDING'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *
```

- The inner `SELECT ... FOR UPDATE SKIP LOCKED` locks exactly the one row
  it selects. A second, concurrent transaction running the identical
  statement **skips** any row already locked by the first — that is
  what `SKIP LOCKED` means — rather than blocking and waiting for it.
- The outer `UPDATE`, in the same statement, transitions that one locked
  row to `PROCESSING` and returns it. There is no gap between "read a
  pending row" and "mark it claimed" that a second caller could observe
  and race into.
- After the transaction commits, the row's lock is released, but its
  `status` is now `PROCESSING` — the `WHERE status = 'PENDING'` filter,
  not the (now-released) row lock, is what prevents a third caller from
  claiming it again later.
- `markProcessed`/`markFailed` both additionally guard with
  `WHERE id = ... AND status = 'PROCESSING'`. This makes the claim ->
  mark handshake self-enforcing at the database: a caller can only ever
  mark processed or failed the exact row it itself just claimed, never a
  row some other caller has since reclaimed (which, given the claim
  semantics above, could only happen if this same row had somehow been
  released back to `PENDING` and reclaimed in between — the guard costs
  nothing and removes that class of bug from consideration entirely).

### Tests that would fail without SKIP LOCKED, not just tests that pass with it

Both concurrency tests in `tenancy-postgres.postgres.test.ts` force
genuine transaction overlap rather than relying on two `Promise.all`
calls happening to race: one claim is held open past its own commit via
an explicit gate (a `Promise` the test resolves later), and the second
claim is only awaited — never released early — so if `SKIP LOCKED` were
removed and the second claim blocked on the first's still-held lock
instead of skipping it, the test would hang until Vitest's timeout
rather than silently pass for the wrong reason. This was verified
directly during development: temporarily removing `SKIP LOCKED` from the
query and re-running just these two tests made both time out, confirmed,
then the clause was restored and the full suite re-verified green twice.
A naive version of these tests (two bare `Promise.all` calls with no
forced overlap) can pass even if `SKIP LOCKED` is silently removed,
because there's no guarantee the two claims' underlying `SELECT`
statements ever actually execute while the other's lock is held — that
naive version was written first, recognized as unfalsifiable, and
replaced with the gated version before this task shipped.

## Idempotency and retry strategy (Section 7)

Two independent categories of failure, decided by
`decideNotificationFailureOutcome` (pure, `notification-processing-decisions.ts`):

| Failure | Category | Resolution |
|---|---|---|
| Delivery port throws any ordinary error (network timeout, provider 5xx, etc.) | Transient | `attempts` incremented; `status` -> `PENDING` if `attempts < MAX_NOTIFICATION_DELIVERY_ATTEMPTS` (retryable — Section 4's "retries remain visible"), else -> `FAILED` (Section 4's "repeated failure") |
| Unknown work-item `type`, or an `INVITATION_CREATED` item with a `null` recipient | Permanent (`NotificationDeliveryPermanentError`) | `attempts` incremented, `status` -> `FAILED` immediately, regardless of how many attempts remain — retrying can never fix either condition |

`MAX_NOTIFICATION_DELIVERY_ATTEMPTS = 5` is a plain exported constant,
**deliberately not a configuration field** — `tenancyConfigSpec` already
exists as the place this module's runtime knobs live (it has
`invitationExpiryDays`), but Section 7 doesn't ask for this number to be
configurable, and adding a config field nobody asked for would be scope
creep, not fidelity to the directive. If a future task needs this
tunable per-deployment, that's a deliberate, separate decision, not an
oversight this task made.

**The two permanent-failure conditions are both currently unreachable
through the normal write path, and one of them is unreachable through
the database at all:**
- An unrecognized `type` cannot exist in the table today — the `CHECK`
  constraint (E05-T14's migration) restricts `type` to exactly the three
  handled values. `assertNotificationWorkItemDeliverable`'s `default`
  branch defends against a hand-crafted row, or a future migration that
  adds a fourth type before this dispatcher is updated to match — not a
  live path today. Its own unit test constructs the invalid value via a
  type-system-bypassing cast, exactly because the database itself won't
  produce one.
- `INVITATION_CREATED` with a `null` recipient is representable in the
  database (`recipient` is nullable independently of `type` — nothing
  ties the two together at the schema level) but never produced by
  E05-T14's own writer (`buildNotificationWorkItemFromEvent` always
  supplies the invitee's email for this type). This task's own
  integration suite proves the defense works by inserting exactly this
  malformed combination directly, bypassing the normal write path.

Neither of these being "currently unreachable" is a reason to remove the
check — it's exactly the kind of boundary defense that matters *because*
it's currently unreachable: the day either assumption stops holding (a
migration changes the `CHECK` constraint, a future writer forgets to set
`recipient`), this is what turns a would-be crash or a silently-wrong
delivery attempt into an honest, terminal `FAILED` row with a legible
`lastError` instead.

## Worker model

This task ships **a function, not a worker.** `processNextNotificationWorkItem`
has no loop, no `setInterval`, no polling, no daemon process — every
call does exactly one cycle. A real worker (a future task, explicitly
deferred by Section 13: "do not add polling loops... timers...
background daemons") would be whatever repeatedly invokes this function
on some cadence — a cron job, a long-running process with its own
sleep/poll loop, a queue consumer triggered by an external scheduler.
None of that exists yet, by design.

### A known, accepted gap: a worker that crashes mid-cycle leaves a `PROCESSING` row behind

The two-transaction design (claim, then deliver, then mark — see above)
is deliberately not one big transaction, for good reasons already
covered. The direct cost of that choice: **if the process running
`processNextNotificationWorkItem` crashes, loses its connection, or is
killed after the claim transaction commits but before the mark
transaction runs — during the delivery call itself, most likely — the
claimed row is left in `PROCESSING` forever.** `claimNextPending`'s
`WHERE status = 'PENDING'` filter means nothing will ever claim that row
again; it is not `FAILED` (Section 4's "failed rows are not lost"
guarantee, which covers rows this processor itself decided to fail, not
rows abandoned by a process that never got to decide anything), not
`PROCESSED`, and not retryable by anything in this task.

This is a real, understood limitation, not an oversight papered over —
this task does not add a `claimedAt` timestamp, a heartbeat, or a
staleness sweep for it, because Section 13 explicitly forbids the
scheduler/timer/daemon that would be needed to *act* on that
information, and adding a column with no consumer would be exactly the
unused-surface mistake this codebase's own prior tasks have repeatedly
caught and removed. A future task that adds real background processing
needs to solve this — concretely, one of:

- Add a `claimedAt` (or `lockedAt`) timestamp column, set by
  `claimNextPending`, and a periodic sweep (the "background daemon"
  Section 13 defers) that reclaims `PROCESSING` rows older than some
  timeout back to `PENDING`.
- A worker heartbeat that renews a claim's freshness while delivery is
  still in flight, with the same kind of sweep reclaiming rows whose
  heartbeat has gone stale.

Either requires the scheduler this task is explicitly told not to build.
Recorded here, deliberately, so the next reader of this design doc (or
the founder reviewing Section 12's "concurrency is safe" claim) does not
mistake "no test covers a crashed worker" for "this was overlooked" —
it was identified, scoped out on purpose, and the two concrete options
for closing it are written down for whichever future task takes it on.

## Future provider integration

Nothing in this task's shape blocks a real provider from being added
later — that is the entire point of the `NotificationDeliveryPort`
abstraction (Section 5). A future task would:

1. Implement `NotificationDeliveryPort` against a real provider
   (SendGrid, SES, Postmark, SMTP, or anything else — genuinely
   undetermined by this task, deliberately) instead of
   `RecordingNotificationDeliveryAdapter`.
2. Inject that real adapter into `processNextNotificationWorkItem`'s
   `deps.delivery` — no other code in this task changes.
3. Build whatever repeatedly calls `processNextNotificationWorkItem` (a
   worker process, a scheduled job) — see "Worker model" above — and,
   at that point, resolve the crashed-worker gap this doc calls out,
   since a real worker running continuously makes that gap a live
   operational concern rather than a theoretical one.

No schema migration is needed for any of this — Section 12's "delivery
can be added later without changing workflows" holds exactly as it did
for E05-T14's own equivalent claim.

## Testing

- **Unit** (`test/application/notification-processing-decisions.test.ts`,
  11 tests): `decideNotificationFailureOutcome` across the full attempts
  range (below/at/above `MAX_NOTIFICATION_DELIVERY_ATTEMPTS`), a
  `NotificationDeliveryPermanentError` overriding the threshold
  regardless of `attempts`, and non-`Error` thrown values being
  stringified rather than propagating; `assertNotificationWorkItemDeliverable`
  across all three known types (including the two null-recipient-allowed
  cases) plus both non-retryable conditions (null recipient on
  `INVITATION_CREATED`, an unrecognized type via a type-bypassing cast).
- **Integration** (`test/integration/tenancy-postgres.postgres.test.ts`,
  "Notification processing service (E05-T15)", 8 tests, real Postgres):
  successful processing (`PROCESSED`, `processedAt` set, delivery invoked
  exactly once); `no_pending_work` when nothing is claimable; replay of a
  processed item prevented (a second call finds nothing left); the two
  falsifiable `SKIP LOCKED` concurrency tests described above; a
  transient failure incrementing `attempts`/recording `lastError`/
  returning to `PENDING`; repeated transient failures exhausting the
  retry budget into terminal `FAILED` (and staying unclaimable
  afterward); a permanently malformed item (`INVITATION_CREATED` with no
  recipient) failing immediately, bypassing the retry budget entirely.

## A real gap this task's own tests caught: the missing `tenancy_platform` UPDATE grant

E05-T14's migration granted `tenancy_platform` only `SELECT` and
`INSERT` on `tenancy.notification_work_items` — sized exactly for that
task's one writer (the invitation-notification consumer, which only ever
`INSERT`s). Running this task's own integration suite for the first time
surfaced the gap immediately: every test failed with `PostgresError:
permission denied for table notification_work_items`, from
`claimNextPending`'s own `UPDATE` statement. `markProcessed`/`markFailed`
would have hit the identical error the moment a claim succeeded.

The fix is migration `0004_grant-tenancy-platform-update-notification-work-items.sql`
— a single additive `GRANT UPDATE ON tenancy.notification_work_items TO
tenancy_platform;` — **a new migration, not an edit to 0003.** Migrations
are immutable once shipped (0003 already ran in every environment that
applied E05-T14's release); the correct fix for a missing grant
discovered later is always another `GRANT`, never a rewrite of a
migration that already ran. This is the same class of finding as
E05-T14's own role-elevation-ordering bug — a real gap caught by running
the actual integration suite against real Postgres, not by review — just
this time a genuinely missing grant rather than an ordering mistake.

## Permanent policy reaffirmed (Section 10)

- **Work is claimed before delivery.** `claimNextPending` transitions
  `PENDING -> PROCESSING` and commits before any delivery I/O begins.
- **Delivery side effects happen after claim.** The delivery port call
  runs with no database transaction open at all.
- **Success is explicit.** `markProcessed` is the only path to
  `PROCESSED`; nothing infers success from the absence of an error.
- **Failure is durable.** Every failure — transient or permanent — is
  recorded via `markFailed` before this function returns; nothing is
  silently swallowed or retried in-process.
- **Retries are observable.** `attempts` and `lastError` are real
  columns, queryable directly, not hidden inside in-process state that
  disappears when a worker restarts.
