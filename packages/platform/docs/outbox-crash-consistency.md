# Component Spec — Outbox Crash-Consistency Suite

- **Task:** E03-T13 · **Status:** Implemented · **Category:** TST (test suite; no new production code)
- **ADR references:** ADR-0009 (transactional outbox pattern)
- **Design docs:** [Architecture §44.5](../../../docs/architecture/ARCHITECTURE.md) ("crash-consistency tests for the outbox (kill the process mid-use-case, assert no lost/duplicated effects after restart)")

## Contract

**Purpose:** prove, against real Postgres, that the outbox pipeline built
across E03-T10 (schema), T11 (writer), and T12 (relay) survives a crash at
each of the three points the blueprint names, with no lost and no
duplicated _effects_:

1. **Crash before commit** — a use case fails partway through its
   transaction. Neither the state change nor the outbox event exist
   afterward.
2. **Crash after commit, before dispatch** — the transaction fully
   commits (state change + outbox event both durable), then the process
   exits before any relay has run. A later, brand-new relay instance
   finds and delivers the event exactly as if nothing had happened — this
   gap being safe _by construction_ is the entire point of the outbox
   pattern.
3. **Crash mid-dispatch** — a relay is partway through a batch when it
   "crashes" (its handler throws, standing in for the process dying).
   Events already handled stay handled; a fresh relay resumes from the
   durable checkpoint and finishes the rest, without re-invoking handlers
   for events that already succeeded.

Every scenario reconstructs the relevant objects (transaction, relay,
store) between phases rather than reusing one long-lived instance — a
test that calls a method twice on the same object could pass by accident
on in-memory state a real crash would have wiped.

## Relationship to T11/T12's own test suites

T11 and T12 already prove pieces of this individually (T11: rollback
discards both a state change and staged events; T12: redelivery resumes
from a durable checkpoint after a fresh relay is constructed). This suite
is not redundant with those — it exercises the **full pipeline together**
(a real use-case-shaped transaction, writing through T11, dispatched
through T12) and adds the angle neither T11 nor T12 tests on its own:
**no duplicated effects**, using a handler with its own idempotent side
effect (`INSERT ... ON CONFLICT (event_id) DO NOTHING` into a
`delivered_effects` table), proving that at-least-once delivery combined
with an idempotent handler produces exactly one durable effect per event
— even when an event was _attempted_ twice across a crash and recovery.

**Deferred, not skipped:** Architecture §44's layer 3 ("port contract-test
suites... every port publishes an abstract test suite") and E03-T14's
production idempotent-consumer helper both anticipate a
`processed_events`-backed dedupe mechanism. This suite doesn't wait for
either — it proves the underlying _contract_ now, with a minimal ad-hoc
`ON CONFLICT DO NOTHING` table standing in for the real helper. Once
E04-T01 ("contract-suite framework") exists, these three scenarios are
natural candidates to become a reusable abstract suite runnable against
any `UnitOfWork` + `OutboxRelayStore` pair, not just the Postgres ones
built so far — noted for that task, not built now.

## Testing

**3 real-Postgres integration tests** (via the dual-mode test-database bootstrap), one per named
scenario, run in the same CI integration lane as every other Postgres
adapter test in this package (`tooling/ci/integration-manifest.json`
already covers `@corestack/platform` broadly — no manifest change needed
for this suite specifically).
