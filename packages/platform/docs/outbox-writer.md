# Component Spec — Outbox Writer

- **Task:** E03-T11 · **Status:** Implemented · **Category:** ADP (Postgres adapter; deliberately does not implement `UnitOfWork` itself)
- **ADR references:** ADR-0009 (transactional outbox pattern), ADR-0004 (Postgres behind ports), ADR-0010 (adapters as optional-peer subpath exports — `./postgres`)
- **Design docs:** [Database §3](../../../docs/architecture/DATABASE.md) (`platform.outbox` exact schema), [Architecture §3/§13](../../../docs/architecture/ARCHITECTURE.md) ("adapters own how" — the `UnitOfWork` port scopes writes + outbox insert into one atomic commit, but leaves the mechanism to each adapter)

## Contract

**Purpose:** given a Postgres transaction handle and a batch of kernel
`DomainEvent`s staged via `TransactionContext.publish`, insert them into
`platform.outbox` (E03-T10) so they commit or roll back atomically with
whatever else runs in that same transaction.

**Public surface:**

| Export                           | Layer                                     | Purpose                                                                                   |
| -------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `writeOutboxEvents(sql, events)` | infrastructure, exported via `./postgres` | Inserts a batch of `DomainEvent`s into `platform.outbox` via an `ISql` handle             |
| `createOutboxStaging()`          | infrastructure, exported via `./postgres` | Bridges `TransactionContext.publish` (kernel port) to a `flush(sql)` call into this table |
| `toOutboxRow(event)`             | domain (main entry)                       | Pure mapping: `DomainEvent` envelope → `platform.outbox` row shape                        |

## Scope: what this task deliberately does not build

The kernel's `UnitOfWork` port (`packages/kernel/src/unit-of-work.ts`) only
gives a use case a `TransactionContext` with `publish(...)` — it says
nothing about how a use case's own repository writes join the _same_
Postgres transaction as the outbox insert. The blueprint splits this
deliberately: **E03-T40** ("Drizzle base setup — tx-scoped `UnitOfWork`
implementation") is the task that owns the real transaction boundary and
decides how repositories obtain a handle into it; T40 depends only on
`E02-T10` (the port itself), not on T11. Building a full
`PostgresUnitOfWork implements UnitOfWork` here would preempt T40's
contract before it's designed. T11 therefore stays narrowly scoped to
"given an open transaction, make publishing into it atomic and correct" —
`createOutboxStaging` is the seam T40 (or any other real `UnitOfWork`
adapter) wires into, by calling `staging.flush(tx)` before its own
transaction commits.

## Failure modes

| Failure                                                           | Behavior                                                                                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `writeOutboxEvents` called with an empty batch                    | No-op — no query is issued                                                                                                                                      |
| The surrounding transaction throws after events were staged       | The whole transaction (including the outbox insert) rolls back — verified against real Postgres: neither the state change nor the staged events exist afterward |
| A staged event's payload is a nested/non-ASCII/null-bearing value | Round-trips through `jsonb` exactly as the original JS value — verified against real Postgres, not assumed (see Design rationale)                               |

## Retry / timeout / cancellation

None at this layer — this adapter doesn't open, retry, or time out
anything; it issues one `INSERT` against whatever transaction it's handed.
Retry/redelivery semantics belong to the relay (E03-T12), not the writer.

## Concurrency guarantees

None added by this component specifically: the insert's atomicity comes
entirely from running inside the caller's transaction, whatever isolation
level that transaction uses. No locking, advisory or otherwise, is needed
here — unlike T02's migration runner, there's no multi-step sequence this
component must serialize.

## Performance

One batched `INSERT ... VALUES (...), (...), ...` per flush — cost scales
with batch size, not with a per-event round trip. Not formally benchmarked
(pending E04-T13, same posture as T02/T10).

## Security considerations

Event payloads are opaque JSON values from the producing module — this
component doesn't validate or sanitize their contents, matching T10's
posture. `writeOutboxEvents` never accepts user input directly; it only
ever receives already-constructed `DomainEvent`s from trusted application
code.

## Observability

None added directly — a thin insert adapter with no branching logic to
observe. Once the relay (T12) exists, dispatch-side observability lands
there.

## Testing

**4 pure domain tests** for `toOutboxRow` (full envelope field mapping,
system actor's null id + platform-scoped null org, causation-id
propagation, and a nested/non-ASCII/null-bearing payload left untouched);
**6 real-Postgres integration tests** (Testcontainers) proving: direct
insert via a bare pool handle, empty-batch no-op, atomic commit alongside
a state-change insert in the same transaction, rollback discarding both
the state change and the staged events when the transaction throws,
`createOutboxStaging`'s `tx.publish` → `flush(sql)` bridge behaving
identically (discarded on rollback, present after a later successful
flush of the same staged batch), and an exact `jsonb` round-trip for a
payload with nested objects, an empty object, a `null` field, and a
non-ASCII string.

**Bug caught before release, not after:** the obvious implementation —
`payload: JSON.stringify(event.payload)` in the row mapping — inserts
without error (the column stores valid JSON either way) but breaks on
read: verified directly against real Postgres that `postgres.js` only
deserializes a `jsonb` column back into a JS object on `SELECT` when the
value was written as a genuine JS value, not a pre-stringified string;
inserting a string still round-trips as a string, silently corrupting
every consumer that expects the original payload shape after a replay.
Fixed by leaving `OutboxEventRow.payload` as the raw value (typed
`unknown` in the domain mapping) and letting `postgres.js` serialize it
itself at the adapter boundary — proven with a nested/non-ASCII/null
payload, not just the trivial `{ ok: true }` case T10's tests happened to
use.

## Design rationale

Why does `writeOutboxEvents` accept `ISql` rather than `Sql` or
`TransactionSql` specifically? Both `Sql` (a connection pool) and
`TransactionSql` (what `.begin()` hands the callback) extend a common
`ISql` interface in `postgres`'s own type definitions — accepting the
common supertype lets one function serve a bare pool (for the "insert
directly, no atomicity needed" case tested here) and a transaction handle
(the primary, atomicity-requiring case) without two code paths, unlike
T02's adapter, which genuinely needed two paths for a different reason
(the `@concurrent` autocommit case cannot run inside `.begin()` at all).
Why is `OutboxStaging.tx` typed as the kernel's own `TransactionContext`
verbatim, rather than a Postgres-specific extension of it? Because this
task isn't the one deciding what a real `UnitOfWork`'s transaction context
looks like (see Scope, above) — a use case written against `tx.publish(...)`
today should keep working unmodified once T40 lands, whatever shape T40
ultimately chooses for the rest of that context.
