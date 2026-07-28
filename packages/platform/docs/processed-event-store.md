# Component Spec — Postgres Processed-Event Store

- **Task:** E03-T14 · **Status:** Implemented · **Category:** ADP (Postgres adapter for the kernel's E02-T03 port)
- **ADR references:** ADR-0009 (transactional outbox pattern), ADR-0004 (Postgres behind ports), ADR-0010 (adapters as optional-peer subpath exports — `./postgres`)
- **Design docs:** [Database §3](../../../docs/architecture/DATABASE.md) (`platform.processed_events` exact schema)

## Contract

**Purpose:** implement the kernel's `ProcessedEventStore` port
(`packages/kernel/src/processed-events.ts`, E02-T03) against
`platform.processed_events` (E03-T10), so `idempotentHandler` (kernel) —
or any handler that wants it directly — gets durable, cross-restart
dedupe instead of the in-memory reference implementation's process-lifetime-only
dedupe.

**Public surface:**

| Export                        | Layer                                     | Purpose                                                              |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `PostgresProcessedEventStore` | infrastructure, exported via `./postgres` | Implements `ProcessedEventStore` against `platform.processed_events` |

## The same-transaction-atomicity nuance, stated plainly

The kernel port's own TSDoc requires: "durable implementations must make
[`markProcessed`] atomic with the handler's effects (same transaction)."
`PostgresProcessedEventStore` accepts `postgres`'s `ISql` (the common
supertype of `Sql` and `TransactionSql`, same as E03-T11's writer), which
makes **true** same-transaction atomicity possible — but only if the
caller wires it that way:

- **Via the generic `idempotentHandler(consumer, store, handler)`
  wrapper (kernel):** `handler` and `store.markProcessed` run as two
  separate sequential steps. If `handler` already committed its own
  effects by the time it resolves (the normal case for a handler that
  isn't itself transaction-aware), there is a small real window between
  the handler's effects and the mark — a crash there redelivers an
  event whose effects already happened. This is _not_ a bug in this
  adapter; it's a structural property of the generic wrapper's shape,
  and it's why the kernel doc frames duplicates as a possibility to be
  handled by idempotent handler logic, not eliminated entirely by the
  store alone.
- **Constructed against an open `TransactionSql` inside a handler that
  does its own writes:** if a handler opens its own transaction, performs
  its state changes, and calls `store.markProcessed(...)` against that
  _same_ transaction before committing, the mark and the effects commit
  or roll back together — genuinely collapsing the window to zero. This
  is the pattern a handler wanting the full guarantee should use, and
  it's exactly what this component's atomicity tests prove.

This isn't a gap introduced by this task — it's an honest description of
what the already-approved kernel port can and can't guarantee depending on
how it's used, made explicit here rather than left as a silent surprise.

## Failure modes

| Failure                                                          | Behavior                                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `markProcessed` called twice for the same `(consumer, event_id)` | No-op the second time (`ON CONFLICT DO NOTHING`) — matches the port's idempotency expectation                                              |
| A handler wrapped by `idempotentHandler` throws                  | Per the kernel port's own contract: the event stays unmarked, so redelivery retries it (verified here too, not just in kernel's own suite) |
| Two different consumers process the same event id                | Independent — `platform.processed_events`' PK is `(consumer, event_id)`, not `event_id` alone                                              |

## Retry / timeout / cancellation

None at this layer — two simple queries, no multi-step sequence to retry
or time out.

## Concurrency guarantees

`ON CONFLICT (consumer, event_id) DO NOTHING` makes `markProcessed` safe
under concurrent callers marking the same pair (e.g. two relay instances
briefly racing) — the row is written exactly once regardless of how many
callers attempt it.

## Performance

One `SELECT` (`hasProcessed`) and one `INSERT ... ON CONFLICT`
(`markProcessed`) per call — both hit the table's primary key directly.
Not formally benchmarked (pending E04-T13, same posture as every other
platform component).

## Security considerations

No new attack surface: `consumer` and `event_id` are supplied by trusted
application code (a handler's own registration and the events the relay
already validated), never raw user input.

## Observability

None added directly — a two-query adapter with no branching worth
instrumenting on its own.

## Testing

**7 real-Postgres integration tests** (via the dual-mode test-database bootstrap): the port's basic
contract (`hasProcessed` false then true), `markProcessed` idempotency,
and — mirroring the exact assertions kernel's own test suite already
makes for `InMemoryProcessedEventStore`
(`packages/kernel/test/unit-of-work.test.ts`) — `idempotentHandler`
invoking the handler exactly once across a redelivery and leaving a
failed event unmarked and retryable, proving this adapter satisfies the
identical behavioral contract the in-memory reference implementation
does. Two consumers processing the same event id independently. Finally,
the Postgres-specific angle no in-memory store can prove: constructed
against an open transaction, `markProcessed` commits atomically with a
handler's own state change, and a later throw in that same transaction
rolls back both together.

## Design rationale

Why not make `markProcessed` itself open its own internal transaction
combining a caller-supplied state-change callback? Because that would
invert control in a way the kernel port doesn't ask for, and would force
every caller through this adapter's transaction-management choices
instead of their own. Accepting `ISql` and documenting the two usage
patterns (bare pool vs. bound to an already-open transaction) keeps the
adapter simple and gives the caller the choice, exactly like E03-T11's
outbox writer.
