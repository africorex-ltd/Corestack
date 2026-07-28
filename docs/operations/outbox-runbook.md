# Outbox Operations Runbook

- **Status:** Part of the implementation — not aspirational documentation
- **Scope:** `platform.outbox`, `platform.outbox_checkpoints`, `platform.processed_events`
- **Related:** [outbox-architecture.md](../platform/outbox-architecture.md), [outbox-observability.md](../platform/outbox-observability.md), [outbox-review.md](../security/outbox-review.md)

Every procedure below is written against the schema and code that actually
ship today (E03-T02/T03, T10-T14). Where a procedure needs a capability
that doesn't exist yet as code (e.g. a `replayFrom` API), it says so and
gives the manual SQL equivalent — it does not pretend the tooling exists.

All SQL examples assume `psql` against the target database, run by an
operator with at least read access to `platform.*`; destructive statements
are marked and require write/DDL privilege.

## How to inspect backlog

Backlog = outbox rows a given consumer has not yet processed.

```sql
-- Current checkpoint for a consumer
SELECT last_occurred_at, last_event_id
FROM platform.outbox_checkpoints
WHERE consumer = 'billing-projector';

-- Backlog count (no checkpoint row = entire outbox is backlog)
SELECT count(*)
FROM platform.outbox o
WHERE NOT EXISTS (
  SELECT 1 FROM platform.outbox_checkpoints c
  WHERE c.consumer = 'billing-projector'
)
OR (o.occurred_at, o.id) > (
  SELECT last_occurred_at, last_event_id FROM platform.outbox_checkpoints
  WHERE consumer = 'billing-projector'
);
```

As of E03-T23, `PostgresOutboxRelayStore.countBacklog(consumer)` runs the
same query programmatically (used by the readiness check's optional
backlog dimension — see
[health-contract.md](../platform/health-contract.md)). The manual query
above remains useful for ad-hoc inspection without wiring up readiness.

## How to inspect checkpoints

```sql
SELECT consumer, last_occurred_at, last_event_id
FROM platform.outbox_checkpoints
ORDER BY consumer;
```

A consumer with **no row** has never processed anything — this is a
normal state for a newly registered consumer, not a fault. Do not confuse
"no checkpoint row" with "caught up"; see
[outbox-partition-maintenance.md](../../packages/platform/docs/outbox-partition-maintenance.md)'s
"dangerous case" note — the same convention applies here.

## How to replay a consumer

There is no `replayFrom` API yet — this is a manual, DDL-adjacent
operation. **This is destructive to the consumer's forward progress**:
it will cause already-processed events to be redelivered. Only do this if
the consumer's own side effects are genuinely idempotent (verify against
`platform.processed_events` first — if this consumer isn't using
`idempotentHandler`/`ProcessedEventStore`, do not replay it without
separately verifying its handler tolerates duplicates).

```sql
-- Full replay from the beginning of the outbox
DELETE FROM platform.outbox_checkpoints WHERE consumer = 'billing-projector';

-- Replay from a specific point (exclusive) instead of the full backlog
UPDATE platform.outbox_checkpoints
SET last_occurred_at = '2026-07-01T00:00:00+00:00', last_event_id = '00000000-0000-0000-0000-000000000000'
WHERE consumer = 'billing-projector';
```

After either statement, the next relay poll round re-fetches from that
cursor per `OutboxRelayStore.fetchBatch`'s contract (rows strictly after
the given cursor, or from the start if `null`).

## How to recover from a crash

The outbox is designed so **no manual recovery step is required** for the
write/relay/checkpoint path itself — this is the property
[outbox-crash-consistency.md](../../packages/platform/docs/outbox-crash-consistency.md)
proves for all three crash points (before commit, after commit
pre-dispatch, mid-dispatch). On restart:

1. The relay resumes from each consumer's last-persisted checkpoint —
   nothing to do.
2. If the crash happened mid-batch, the next poll round naturally
   re-delivers from the last successfully advanced event; idempotent
   consumers (via `ProcessedEventStore`) absorb the redelivery as a no-op.
3. **Verify, don't assume:** run the backlog query above per consumer
   after restart to confirm it is draining, not stuck (see "diagnose
   stalled delivery" below if it isn't).

The only case requiring operator action is if the crash corrupted
application-level state outside the outbox's own guarantees (e.g. a
non-idempotent consumer double-processed something before this epic's
idempotency helper was adopted) — that is a consumer-specific incident,
out of scope for this runbook.

## How to pause a relay

There is no separate "pause" flag distinct from stopping the process —
`OutboxRelay` is a `Drainable`:

```ts
await relay.stopIntake(); // stop scheduling new poll rounds
await relay.drain(); // wait for any in-flight round to finish and its checkpoint to advance
```

This is the same sequence the graceful-shutdown orchestrator (E03-T24)
runs automatically on process shutdown signals. To pause without killing
the process, call `stopIntake()`/`drain()` directly from an operational
hook (e.g. an admin endpoint) if one exists in your deployment; there is
no platform-provided admin surface for this today.

## How to resume a relay

Call `relay.start()` again on the same (still-live) `OutboxRelay`
instance. If the process was fully stopped rather than paused in-process,
simply starting the process again re-constructs and starts the relay from
whatever checkpoint state persisted — there is no separate "resume" state
to restore, by design (the checkpoint table is the only durable state).

## How to rotate partitions

```ts
import { maintainOutboxPartitions } from "@corestack/platform/postgres";

const report = await maintainOutboxPartitions(sql, {
  monthsAhead: 2, // default
  // retentionMonths omitted: create-ahead only, no drops
  expectedConsumers: ["billing-projector", "audit-log"],
});
console.log(report); // { created, dropped, blocked }
```

There is no scheduler wired to call this automatically yet (no jobs epic
built). Run it manually (or via a cron-equivalent you control) at least
as often as `monthsAhead` allows lead time for — e.g. monthly, with the
default `monthsAhead: 2`, gives one month of slack if a run is missed.

To also enable retention drops, pass `retentionMonths`:

```ts
const report = await maintainOutboxPartitions(sql, {
  retentionMonths: 6,
  expectedConsumers: ["billing-projector", "audit-log"],
});
```

**Always pass the full, accurate `expectedConsumers` list.** Omitting a
real consumer from this list means retention has no way to protect its
backlog — see "verify retention safety" below and the security review's
retention-abuse section.

## How to verify retention safety before enabling drops

Before setting `retentionMonths` in any environment for the first time:

1. List every consumer that actually reads `platform.outbox` — check
   `EventSubscription.consumer` values wired into the running
   `OutboxRelay`, not just what's in `outbox_checkpoints` today (a
   consumer that hasn't started yet still needs protecting).
2. Confirm `expectedConsumers` passed to `maintainOutboxPartitions`
   matches that list exactly. A consumer left off the list gets **no
   protection** — its unprocessed backlog can be silently dropped.
3. Run `maintainOutboxPartitions` once with a **lower** `retentionMonths`
   than intended in a non-production environment first, and inspect the
   returned `report.blocked` array — every partition a real consumer
   hasn't reached should appear there with a reason.
4. Only then apply the intended `retentionMonths` in production.

## How to diagnose duplicate deliveries

Duplicate delivery (the same event handled more than once) is **expected
behavior** under at-least-once delivery, not a bug by itself — the
question is whether `ProcessedEventStore` correctly suppressed the
duplicate side effect.

```sql
-- Has this consumer already processed this event?
SELECT * FROM platform.processed_events
WHERE consumer = 'billing-projector' AND event_id = '<event-uuid>';
```

If a row exists but the consumer's side effect still ran twice, the
handler is not actually going through `idempotentHandler`/
`ProcessedEventStore.markProcessed` correctly — check that the consumer
calls `markProcessed` only after its own effect succeeds, and that it
checks `hasProcessed` before running the effect (see
[processed-event-store.md](../../packages/platform/docs/processed-event-store.md)'s
note that true same-transaction atomicity requires the handler to bind
the store to its own open transaction — the generic wrapper alone gives
at-least-once suppression, not a database-enforced guarantee).

## How to diagnose stalled delivery

1. Confirm the process is alive and the relay was actually started
   (`relay.start()` called, not just constructed).
2. Check the checkpoint isn't advancing: run the checkpoint query above
   twice, a poll interval apart. If `last_occurred_at`/`last_event_id` are
   unchanged and backlog is nonzero, the relay is stuck.
3. Check the logs for the one failure signal the relay emits today:
   `outbox-relay: consumer "<name>" failed on event` (logged via
   `logger.warn` with `eventId`/`eventName`/`error`). A permanently
   failing handler on the first event in a batch stops that consumer's
   checkpoint from advancing past it, by design (see
   [outbox-relay.md](../../packages/platform/docs/outbox-relay.md)'s
   contract) — the fix is to fix or route around the failing handler,
   not to force-advance the checkpoint (which would silently lose that
   event for this consumer).
4. If no failure is logged and the checkpoint still isn't moving, verify
   `pollIntervalMs` is what you expect and that `start()` was actually
   called — a relay that was only constructed (never started) will never
   poll.
5. As a last resort, only after confirming the handler itself is fixed:
   manually re-run one `pollOnce()` call in a debug/admin context and
   observe whether it advances — this isolates "the loop isn't running"
   from "the loop runs but the handler keeps failing."
