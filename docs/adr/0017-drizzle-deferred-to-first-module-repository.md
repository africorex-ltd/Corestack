# ADR 0017: Drizzle's introduction is deferred to the first module repository adapter, not E03-T40

- **Status:** Accepted
- **Date:** 2026-07-29
- **Elaborated in:** [ADR-0004](0004-postgresql-behind-repository-ports.md), [ADR-0009](0009-transactional-outbox-no-event-sourcing.md), [ADR-0010](0010-adapters-as-subpath-exports.md)

## Context

ADR-0004 already decided the reference persistence adapters will use
Drizzle ORM, with the explicit caveat "confirmed when the first
persistence adapter lands." The engineering blueprint's E03-T40 row reads
"Drizzle base setup — connection management, tx-scoped `UnitOfWork`
implementation, no-await-across-connection discipline (DB §20.2)" — which
reads as an instruction to introduce the `drizzle-orm` dependency now, as
part of T40.

Examining what T40 actually needs to build: a `PostgresUnitOfWork`
implementing the kernel's already-approved `UnitOfWork` port
(`packages/kernel/src/unit-of-work.ts`). That port's contract is
transaction-scoping and event-staging (`TransactionContext.publish`,
flushed into `platform.outbox` atomically via E03-T11's already-shipped
`createOutboxStaging`/`writeOutboxEvents`, then committed). None of that
requires a schema-aware query builder — it requires exactly what T02,
T10–T14, T23, T30, and T31 already use: the raw `postgres` driver's
`sql.begin()` transaction.

## Decision

**T40 implements `PostgresUnitOfWork` and connection-management discipline
using the existing raw `postgres` driver, adding no `drizzle-orm`
dependency.** ADR-0004's decision to use Drizzle for the reference
persistence adapters stands unchanged — it is simply not yet triggered,
because no module repository adapter (the first real "persistence
adapter" ADR-0004's caveat refers to) exists yet. Every module's own
repository layer is out of scope until E05+.

Introducing `drizzle-orm` now, with no schema and no consumer, would be
exactly the "unused flexibility is a liability" pattern this project's
own design principles reject — a thin factory function wrapping a driver
with nothing to query is speculative scaffolding, not infrastructure a
real component needs.

## Alternatives considered

- **Add `drizzle-orm` in T40 as a thin, schema-free base** (e.g. a
  `createDrizzleClient(sql)` factory) so the dependency is "in place" for
  future work: rejected. It would ship with zero test coverage worth
  writing (there is nothing to query) and no design decisions actually
  made (schema conventions, migration integration with T01/T02's own
  plain-SQL migration format) — deferring it fully is more honest than
  partially wiring it.
- **Revise ADR-0004 to drop Drizzle entirely:** rejected — no evidence yet
  that Drizzle is unsuitable; ADR-0004's own text already anticipates
  exactly this situation ("revisit in its own ADR if Drizzle proves
  limiting") and nothing has proven it limiting. This ADR is a scheduling
  clarification, not a reversal.

## Consequences

- `@corestack/platform`'s dependency footprint stays exactly as narrow as
  the actual shipped capabilities require (ADR-0010's posture).
- The first module built with a real repository adapter (E05+) is where
  ADR-0004's Drizzle decision is actually exercised and confirmed or
  revisited — that module's own ADR/component-spec work will need to
  address schema conventions and how Drizzle's migration story reconciles
  with T01's plain-SQL migration format, none of which T40 needed to
  decide.
- E03-T40's blueprint row title ("Drizzle base setup") is executed in
  spirit — connection management and a tx-scoped `UnitOfWork` — without
  the literal dependency, which this ADR records as the reconciliation.
