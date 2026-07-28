# Component Spec — Outbox Relay

- **Task:** E03-T12 · **Status:** Implemented · **Category:** ADP (Postgres-backed adapter; the orchestration itself is pure/testable)
- **ADR references:** ADR-0009 (transactional outbox pattern), ADR-0004 (Postgres behind ports), ADR-0010 (adapters as optional-peer subpath exports — `./postgres`)
- **Design docs:** [Database §3](../../../docs/architecture/DATABASE.md) (`platform.outbox`, `platform.outbox_checkpoints` exact schemas), [Architecture §13/§44.5](../../../docs/architecture/ARCHITECTURE.md) (at-least-once delivery; crash-consistency scenarios)

## Contract

**Purpose:** poll `platform.outbox` on a per-consumer cursor and dispatch
matching events to that consumer's handler, one `EventSubscription`
(kernel's own `EventBus` subscription shape, reused verbatim) at a time,
advancing `platform.outbox_checkpoints` only past events the handler has
actually finished — durably, not from in-memory state.

**Normative behavior:**

- **Per-consumer checkpoints.** Each subscription's `consumer` name reads
  the outbox on its own cursor; one consumer's failure or pace never
  affects another's — proven with two subscriptions over the same stream,
  one permanently throwing.
- **No checkpoint row = start from the beginning.** Mirrors T02's
  "absence of a row means never processed anything" convention. A
  consumer registered after events already exist replays the whole
  backlog — the correct default (a newly added audit consumer must
  backfill, not silently miss history that predates it).
- **Checkpoint advances only past events fully handled.** Events are
  processed strictly in `(occurredAt, id)` order; the first handler
  failure in a batch stops advancement at the last successfully processed
  row (matching or not) — the next round redelivers from the failed event
  onward, never from the start.
- **At-least-once, not exactly-once.** A crash between a handler
  succeeding and the checkpoint persisting redelivers that one event;
  handlers must be idempotent (E03-T14, built on `processed_events`, is
  the dedupe helper for this — not this task's job).

**Public surface:**

| Export                                  | Layer                                     | Purpose                                                                                   |
| --------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `OutboxRelay`                           | application                               | `Drainable`-implementing orchestrator: `start()`, `pollOnce()`, `stopIntake()`, `drain()` |
| `OutboxRelayStore` (port)               | application                               | `getCheckpoint`, `fetchBatch`, `advanceCheckpoint`                                        |
| `PostgresOutboxRelayStore`              | infrastructure, exported via `./postgres` | The reference adapter — real `(occurred_at, id)` row-value cursor comparison              |
| `InMemoryOutboxRelayStore` (`/testing`) | testing                                   | Fake store for pure orchestration tests                                                   |

## The row-value cursor, and why it isn't two `AND`-ed columns

`WHERE occurred_at > $1 AND id > $2` silently drops any event that shares
the checkpoint's exact `occurred_at` but sorts lower by `id` — a real risk
whenever a producer batches multiple events with the same timestamp (a
single use case publishing several events in one `UnitOfWork.run`, for
example — exactly what E03-T11 makes easy to do). The store instead uses
`WHERE (occurred_at, id) > ($1::timestamptz, $2::uuid)`, a genuine
Postgres row-value comparison, matched by the `outbox_occurred_at_id_idx`
index from T10. Verified directly: a test inserts two events at the
identical instant, deliberately ordered so the second-created event's
`id` sorts _lower_ than the first's, and confirms both are eventually
delivered across two single-event batches — the exact case a naive
`AND`-ed predicate would drop.

## Failure modes

| Failure                                                           | Behavior                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A consumer's handler throws partway through a batch               | Processing for that consumer stops at the failure; the checkpoint is left at the last successfully processed row; the next round redelivers from the failed event on                                                                                                                        |
| A consumer's handler fails permanently (every attempt throws)     | That consumer's checkpoint never advances past the failing event and it's retried every round — by design; other consumers on the same stream are unaffected                                                                                                                                |
| The process crashes mid-round, after some handlers succeeded      | Only the successfully processed events are reflected in the durable checkpoint; a fresh relay instance (new process) resumes exactly there — proven by discarding the relay/store objects entirely between rounds in the integration suite, not just calling a method twice on one instance |
| An event doesn't match a subscription's `event`/`versions` filter | Skipped without invoking the handler, but the checkpoint still advances past it — otherwise a consumer subscribed to a rare event name would refetch the same irrelevant rows forever                                                                                                       |

## Retry / timeout / cancellation

No per-event retry beyond the natural "next poll round retries from the
checkpoint" behavior — there is no backoff or attempt-counting; a
permanently failing consumer retries every event every round until fixed
or unsubscribed. Deliberately no adaptive backoff: `pollIntervalMs` is a
plain fixed interval, keeping behavior (and tests) deterministic.

## Concurrency guarantees

Consumers are processed sequentially within one round (isolated by a
per-subscription try/catch so one's failure can't abort another's turn),
and each consumer loops internally until its batch comes back under
`batchSize` (catching up within one round rather than trickling one
partial batch per poll interval when backlog exists). Running two relay
processes against the same consumer name concurrently is out of scope for
this task — nothing here prevents a duplicate-processing race in that
case; that's a deployment-topology concern (run one relay instance),
not a gap this component's tests paper over.

## Performance

One batched `SELECT` and, when anything advanced, one `INSERT ... ON
CONFLICT` per consumer per round — cost scales with backlog size and
consumer count, not event count times poll count (thanks to the
catch-up-within-a-round loop). Not formally benchmarked (pending E04-T13,
same posture as every prior platform component).

## Security considerations

No new attack surface: the relay only reads `platform.outbox` (already
trusted, produced by E03-T11 from application code) and writes its own
checkpoint table. Handler code is trusted application code (the consumers
registered by a module), not user input.

## Observability

`onLag(consumer, lagMs)` reports how far behind wall-clock now a
consumer's newest confirmed checkpoint is — `0` once a round finds nothing
new, non-zero (the age of the last delivered event) right after
processing a non-empty batch. `logger` receives a `warn` on each handler
failure (with the failing event's id/name) and on an unexpected round-level
failure, but never throws out of `pollOnce()` — a broken consumer is a
logged fact, not a reason to crash the relay or block siblings.

## Testing

**6 domain tests** (`fromOutboxRow`, the relay's read-side mapping,
including an exact round-trip against T11's `toOutboxRow` across the
Date↔ISO-string boundary); **8 pure orchestration tests** (in-memory
fake) covering ordered delivery, stop-on-failure + correct redelivery
scope, two-consumer isolation, name/version filtering with checkpoint
still advancing past skipped rows, wildcard subscriptions, the
catch-up-within-one-round loop under a small `batchSize`, lag reporting,
and `Drainable` semantics with no active round; **4 real-Postgres
integration tests** (via the dual-mode test-database bootstrap) proving: no event skipped across a
full restart (relay and store objects discarded and rebuilt between
rounds — not just re-invoking a method on one long-lived instance),
correct redelivery scope after a simulated mid-batch crash, the
row-value cursor correctness case described above, and `drain()` letting
an in-flight round's checkpoint persist before returning.

## Design rationale

Why reuse the kernel's own `EventSubscription` type rather than defining
a relay-specific subscription shape? A module's consumer registration
shouldn't need to know whether it's being served by the in-process
`EventBus` (synchronous, at-most-once beyond the process) or this durable
relay (asynchronous, at-least-once) — the same `{ consumer, event,
versions, handler }` value works for either, and the matching predicate
here (`event`/`versions` filtering) deliberately mirrors
`InMemoryEventBus.publish`'s logic exactly, so a consumer's semantics
don't silently change depending on which delivery path is wired up to it.
Why does the checkpoint advance past _non-matching_ events too, not just
delivered ones? Because the cursor is a physical position in the shared
outbox stream, not a logical "last delivered event" — if it only tracked
matching events, a consumer subscribed to a rare event name would rescan
every irrelevant row on every single round, forever, as the outbox grows.
