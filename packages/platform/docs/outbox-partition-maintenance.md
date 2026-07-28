# Component Spec — Outbox Partition Maintenance

- **Task:** E03-T03 · **Status:** Implemented · **Category:** ADP (Postgres adapter; a callable function, not a running job)
- **ADR references:** ADR-0009 (transactional outbox pattern), ADR-0004 (Postgres behind ports)
- **Design docs:** [Database §3](../../../docs/architecture/DATABASE.md) (`platform.outbox` "old partitions dropped per retention policy after all checkpoints pass them"; `platform.processed_events` "pruned in step with outbox retention"), [Database §18](../../../docs/architecture/DATABASE.md) ("partitioned tables create next-period partitions ahead of time via scheduled job... with `pg_partman` as optional convenience")

## Contract

**Purpose:** two independent, callable responsibilities over `platform.outbox`'s
monthly partitions:

1. **Create-ahead:** ensure the next `monthsAhead` (default 2, per this
   task's acceptance criteria) months' partitions exist, reusing E03-T10's
   exact partition-creation DDL (extracted into a shared helper so the two
   never drift apart).
2. **Retention-drop (opt-in):** only runs when `retentionMonths` is given.
   A partition older than the retention window is dropped **only once
   every expected consumer's checkpoint has advanced past it** — and its
   corresponding `platform.processed_events` rows are pruned in the same
   transaction as the drop.

This is a plain callable function — `maintainOutboxPartitions(sql, options)`
— not a running daemon. There is no scheduler module yet to wire it into
(the blueprint's Jobs epic is separate, not yet built); a future CLI
command or scheduled job calls this the same way `ensureOutboxSchema`
(E03-T10) is called at boot rather than run as a service itself.

**Public surface:**

| Export                                                           | Layer                                     | Purpose                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `maintainOutboxPartitions(sql, options)`                         | infrastructure, exported via `./postgres` | The orchestration: create-ahead + opt-in retention-drop + `processed_events` prune |
| `planPartitionDrops(partitions, cutoff, consumers, checkpoints)` | domain                                    | Pure decision logic — no I/O — testable exhaustively without Postgres              |
| `partitionUpperBound(name)`                                      | domain                                    | Inverse of E03-T10's name generation — parses `outbox_YYYY_MM` back to its bound   |

## Why retention has no default, and why an empty consumer list is not the same as an unsafe one

The approved design docs deliberately leave the retention window as an
open policy decision ("per retention policy"), not a specified number.
`retentionMonths` is therefore optional with **no default** — omitting it
means "run create-ahead only, never attempt a drop." A destructive
default would be the wrong failure mode for an operation that
irreversibly deletes committed events.

`expectedConsumers` has no default either, but for a different reason:
absence of a checkpoint row for a given consumer means "this consumer has
never processed anything" (E03-T12's own convention) — **not** "there is
no such consumer." The obviously-wrong version of this job would query
`platform.outbox_checkpoints` for the minimum `last_occurred_at` across
existing rows and treat an empty result as "everyone's caught up" — that
authorizes dropping a fresh deploy's entire outbox before the relay has
ever run, because a fresh deploy has zero checkpoint rows, not because
nothing needs protecting. `expectedConsumers` forces the caller to
declare the full guest list; a consumer on that list with no row (or a
row that hasn't reached the partition) blocks the drop. An **empty**
`expectedConsumers` list is different from a missing one: it's the
caller's explicit statement that no consumer depends on this outbox yet,
so drops proceed on retention age alone — tested as its own scenario, not
conflated with the missing-checkpoint case.

## Failure modes

| Failure                                                                    | Behavior                                                                                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An expected consumer has no checkpoint row yet                             | Every partition that consumer would need is blocked from dropping, regardless of age — proven directly as "the dangerous case" in the integration suite    |
| An expected consumer's checkpoint hasn't reached a partition's upper bound | That partition (and every consumer sharing it) is blocked; other, older partitions the lagging consumer _has_ passed may still drop                        |
| `retentionMonths` omitted                                                  | Create-ahead runs; the drop phase is skipped entirely — `dropped`/`blocked` are always empty in the returned report                                        |
| A partition exists whose name doesn't match `outbox_YYYY_MM`               | Ignored by both create-ahead and drop planning — never guessed at, matching T10's own posture toward anything not created by this package's own convention |

## Retry / timeout / cancellation

None — this is a one-shot maintenance pass; a future scheduler decides
how often to call it, and a failed call is safe to simply call again
(create-ahead is idempotent; drop planning is recomputed from scratch
each call, so a partial previous failure leaves nothing inconsistent to
recover from).

## Concurrency guarantees

Each partition's prune-and-drop runs inside its own transaction
(`sql.begin`), so a crash mid-drop either fully removes the partition and
its `processed_events` rows together, or leaves both fully intact —
never a partition gone with its dedupe rows still present (or vice
versa). Running two maintenance calls concurrently is not specifically
guarded against (out of scope, same posture as E03-T12's relay toward
running two relay processes for the same consumer) — this is a
low-frequency operational job, not a request-path component.

## Performance

Create-ahead is a handful of idempotent DDL statements. Drop planning is
one `pg_inherits`/`pg_class` query plus one `outbox_checkpoints` lookup
scoped to the expected-consumer list, independent of outbox row count.
Not formally benchmarked (pending E04-T13, same posture as every other
platform component).

## Security considerations

No new attack surface: inputs are operator-supplied configuration
(retention months, expected consumer names), never end-user input.
Partition and consumer names are only ever used to filter query results
or build DDL from this module's own deterministic naming convention
(`outbox_YYYY_MM`), never from unvalidated external strings.

## Observability

None added directly — the returned `OutboxPartitionMaintenanceReport`
(`created`, `dropped`, `blocked` with reasons) is the caller's hook for
logging or alerting; this component doesn't log on its own, matching
every other boot/maintenance-time component in this package.

## Testing

**10 pure domain tests**: `partitionUpperBound` (exact inverse of the
name-generation function, year rollover, `null` for non-matching names)
and `planPartitionDrops` (too-recent partitions untouched, drops proceed
with zero expected consumers, the dangerous no-checkpoint-row case
blocks, a checkpoint short of the boundary blocks, a checkpoint exactly
at the boundary is sufficient, one lagging consumer among several blocks
the whole partition, and multiple partitions evaluated independently in
one call); **7 real-Postgres integration tests** (via the dual-mode test-database bootstrap)
proving: create-ahead genuinely creates the next 2 months beyond what
E03-T10's bootstrap left, idempotent re-runs create nothing new, omitting
`retentionMonths` never drops even a manufactured old partition, the
dangerous fresh-deploy case (old partition, zero checkpoint rows) drops
nothing, a fully-caught-up consumer set drops the partition _and_ prunes
its `processed_events` rows in the same operation, a second lagging
consumer blocks the drop even when the first consumer is fully caught
up, and — proving the prune is gated on the actual drop rather than the
configured retention age — a blocked partition's `processed_events` rows
are left untouched.

## Design rationale

Why enumerate existing partitions via `pg_inherits`/`pg_class` rather
than parsing Postgres's own partition-bound expression
(`pg_get_expr(relpartbound, ...)`)? This module's own partitions are
always named `outbox_YYYY_MM` by construction (E03-T10's convention) —
deriving bounds from the name it already generates is exact and trivial,
while parsing Postgres's bound-expression text back into a `Date` is a
real time sink that buys nothing here. Any partition whose name doesn't
match is simply skipped by both create-ahead and drop planning — the
right behavior if an operator ever attaches a partition by hand, since
guessing at its bounds would risk acting on a partition this module
doesn't actually understand. Why prune `processed_events` by capturing
the exact `event_id`s in a partition before dropping it, rather than
deleting by a `processed_at` cutoff? `processed_events` doesn't store
`occurred_at` — a row's `processed_at` (when a consumer finished
handling it) can lag well behind the event's own timestamp, so cutting on
`processed_at` would either prune too little (leaving orphaned dedupe
rows for genuinely dropped events) or too much (deleting dedupe
protection for events whose partition wasn't actually dropped). Deleting
by the exact `event_id`s a partition contained is precise regardless of
when each was processed.
