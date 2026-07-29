# Component Spec — Postgres Unit of Work

- **Task:** E03-T40 · **Status:** Implemented · **Category:** ADP (Postgres adapter for the kernel's ADR-0009 port)
- **ADR references:** ADR-0009 (transactional outbox pattern — the `UnitOfWork` port this implements), ADR-0008 (pooled multi-tenancy, layer 3), ADR-0004 (Postgres behind ports), ADR-0010 (`./postgres` subpath), ADR-0017 (Drizzle deferred — this task does not introduce it)
- **Design docs:** [Database §20.2](../../docs/architecture/DATABASE.md) (connection pooling, no-await-across-connection discipline)

## Contract

**Purpose:** implement the kernel's `UnitOfWork` port
(`packages/kernel/src/unit-of-work.ts`) against real Postgres — one
transaction per `run()` call, with events staged via `TransactionContext.publish`
made durable in `platform.outbox` (E03-T11) atomically with the rest of
the transaction's writes, and RLS's `app.current_org` (ADR-0008 layer 3)
set for the transaction's duration when the use case is org-scoped.

**Public surface:**

| Export                       | Layer                        | Purpose                                                                      |
| ---------------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| `PostgresUnitOfWork`         | infrastructure, `./postgres` | Implements `UnitOfWork`; one Postgres transaction per `run()` call           |
| `PostgresTransactionContext` | infrastructure, `./postgres` | Extends kernel's `TransactionContext` with `sql: TransactionSql` (see below) |

## What T40 does not do (ADR-0017)

The blueprint's row names this task "Drizzle base setup." No `drizzle-orm`
dependency is added. `PostgresUnitOfWork`'s actual requirements —
transaction scoping and atomic event staging — are fully served by the
already-shipped raw `postgres` driver (`sql.begin()`) and E03-T11's
`createOutboxStaging`. ADR-0004's decision to use Drizzle for the
reference **persistence adapters** stands, but is triggered by the first
real module repository (E05+), not by a transaction-boundary component
with no schema of its own to query. See ADR-0017 for the full reasoning.

## Why `PostgresTransactionContext` extends the kernel's `TransactionContext`

Kernel's `TransactionContext` is deliberately minimal — `publish` only —
so the port stays database-agnostic (the in-memory reference
implementation needs nothing more). But that shape gives a use case's own
repository calls **no way to reach the open transaction** at all, which
would make `PostgresUnitOfWork` useless for anything beyond publishing
events. `PostgresTransactionContext` adds one field, `sql: TransactionSql`
— the exact open transaction handle `run()` is managing — so repository
code called from inside `work()` can run its own queries against the same
transaction the staged events will commit with.

This is additive only on the concrete adapter; kernel's own
`TransactionContext` type is untouched, the same class of extension as
E03-T23's optional `countBacklog` port member. A caller holding a plain
`UnitOfWork`-typed reference (not `PostgresUnitOfWork` directly) still
type-checks against the narrower kernel port and never sees `.sql` — the
widened parameter type is contravariantly compatible with the interface's
`run(work: (tx: TransactionContext) => Promise<T>)` signature, verified
directly against `tsc --noEmit`.

## Transaction ownership: `UnitOfWork` vs. `withOrgContext`/`runOrgScopedQuery`

Three components now each know how to open a Postgres transaction and set
`app.current_org`: `withOrgContext` (E03-T30), `runOrgScopedQuery` (E03-T31,
built on `withOrgContext`), and `PostgresUnitOfWork` (E03-T40). They must
never be nested — `TransactionSql` has no `.begin()` (confirmed while
building E03-T31), so composing two transaction-opening helpers doesn't
even work mechanically, on top of the kernel port's own rule ("nesting is
not supported — a use case is the transaction boundary"). The rule:

- **Inside a `UnitOfWork.run()` callback:** use `ctx.sql` for repository
  queries. Do not call `withOrgContext`/`runOrgScopedQuery` here — they
  would try to open a second transaction on the same connection pool.
- **Outside a unit of work** (a read-only query, or any repository call
  not participating in a use case's atomic write): use `withOrgContext`/
  `runOrgScopedQuery` directly against the pool.

## Why `run()` never dispatches to an `EventBus`

`InMemoryUnitOfWork` (kernel's reference implementation) dispatches staged
events to its bus synchronously once `work` resolves — appropriate for
tests and non-durable composition, where there's no crash-recovery story
to preserve. `PostgresUnitOfWork` does the opposite: it writes staged
events into `platform.outbox` and nothing else. Dispatch to actual
subscribers is the outbox relay's job (E03-T12), running later,
asynchronously, against the durably-committed rows — which is also why
"consumer failures never fail the producer" (AUD-03) holds trivially here:
no consumer/handler code ever executes inside `run()` at all, so there is
nothing for a `run()` caller to catch a consumer's exception from in the
first place.

## Real per-role credentials remain out of scope

E03-T30 and E03-T31 both deferred "how a real deployment authenticates as
the `NOLOGIN` application role" to E03-T40. **T40 does not resolve this
either.** Real connection credentials are deployment configuration (which
environment variable holds the app role's password, how it's provisioned,
whether it's a dedicated login role or a `SET ROLE`-based scheme) — not a
decision this package's code should encode. `PostgresUnitOfWork` accepts
whatever already-connected `Sql` instance it's given; which role that
connection authenticated as is the composition root's concern, same as
every other adapter in this package.

## Failure modes

| Failure                                 | Behavior                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `work` throws                           | The whole transaction rolls back — both the use case's own writes and any staged events, via Postgres's own rollback |
| `work` never calls `publish`            | No rows written to `platform.outbox`; the transaction still commits normally for any other writes                    |
| Constructed with `organizationId: null` | `app.current_org` is never set — a platform-scoped use case, not an error                                            |

## Retry / timeout / cancellation

None at this layer — one attempt per `run()` call, matching this
package's posture toward every other transaction-boundary component (no
built-in retry loop; a caller decides whether and how to retry a failed
use case).

## Concurrency guarantees

Each `run()` call opens its own transaction on its own connection from the
pool; concurrent `run()` calls (even from the same `PostgresUnitOfWork`
instance) never interfere with each other's `app.current_org` or staged
events — proven directly by running two `PostgresUnitOfWork` instances
constructed with different organization ids sequentially and confirming
neither sees the other's context.

## Performance

One transaction (`BEGIN`/`COMMIT`), one `set_config` call if org-scoped,
one batch `INSERT` into `platform.outbox` if any events were staged, plus
whatever the use case's own `work` callback does. Not formally benchmarked
(pending E04-T13, same posture as every other platform component).

## Security considerations

`organizationId` is supplied by the composition root at construction time
(expected to come from an already-resolved `Context`, E03-T32), never
client-asserted input. `ctx.sql` gives repository code inside `work()` a
real Postgres connection — the same trust level every other adapter in
this package already operates at; this component adds no new privilege
surface.

## Observability

None added directly — matches this package's posture toward every other
boot/transaction-time component. A future logging/tracing layer wraps
`run()` calls from the outside if per-use-case instrumentation is needed.

## Testing

**No pure unit tests** — this adapter has no logic that isn't Postgres
transaction orchestration, matching E03-T13's crash-consistency suite's
posture (real-Postgres-only where the entire point is proving real
transactional behavior).

**6 real-Postgres integration tests**
(`test/integration/unit-of-work.postgres.test.ts`): `run()` returns the
work callback's result; staged events commit atomically with the work's
own writes (via `ctx.sql`, proving genuine same-transaction behavior, not
just "ran without erroring"); both are rolled back together when `work`
throws; `app.current_org` is set for the transaction's duration when
constructed with an organization id; it is not set (matching E03-T30's
`NULL`/`''` finding) for a platform-scoped instance; and two sequential
`run()` calls with different organization ids never leak state into each
other.

## Design rationale

Why does `PostgresUnitOfWork` take `organizationId` at construction time
rather than as a parameter to `run()`? A `UnitOfWork` instance is already
naturally scoped to one use case (kernel's own doc: "one unit of work per
use case"), and a use case's organization scope is fixed for its whole
duration — there's no scenario where the same instance would need to
`run()` twice under different organizations. Binding it at construction
also means a composition root can build one `PostgresUnitOfWork` per
resolved `Context` and hand it straight to a use case, with no
per-call org-id plumbing.

Why not have `PostgresUnitOfWork` construct and own its own
`PostgresOutboxRelayStore`/relay, dispatching events itself instead of
merely staging them? That would collapse two independent, already-shipped
components (the transactional write boundary, and asynchronous at-least-once
delivery) into one — exactly the coupling ADR-0009's outbox pattern exists
to avoid. `run()` staying "durability only" keeps a producer's commit
latency independent of however many consumers exist or how slow they are.
