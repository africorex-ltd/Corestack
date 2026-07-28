# E03 Outbox Epic — Milestone Report & Infrastructure Consolidation

- **Date:** 2026-07-28 · **Mode:** Platform Maturity (governance §13)
- **Scope of this report:** the transactional-outbox portion of E03
  (T02-T03, T10-T14) plus the Infrastructure Consolidation pass that
  followed it. **This is a mid-epic checkpoint, not the E03 exit health
  report.** E03 as a whole (see
  [E03-entry-review.md](E03-entry-review.md)) is a 24-task epic; T23,
  T30/T31/T33, and T40-T43 remain. The full Engineering Health Report +
  lessons-learned the entry review promises at epic exit, and the first
  dated architecture-benchmark report (per
  [architecture-benchmarks/README.md](../../quality/architecture-benchmarks/README.md),
  "first real report at E03 exit"), both still land later, once the
  actual epic closes.

## 1. What shipped

| Task | What                                                                                           | Status |
| ---- | ---------------------------------------------------------------------------------------------- | ------ |
| T02  | `platform.module_migrations` runner (advisory-lock serialized, chain-checksum drift detection) | ✅     |
| T10  | Outbox schema bootstrap (`platform.outbox` monthly-partitioned, checkpoints, processed_events) | ✅     |
| T11  | `writeOutboxEvents`/`createOutboxStaging` — the write path                                     | ✅     |
| T12  | `OutboxRelay` — per-consumer checkpointed polling relay                                        | ✅     |
| T13  | Crash-consistency proof suite (3 crash points, ADR §44.5)                                      | ✅     |
| T14  | `PostgresProcessedEventStore` + idempotent-consumer integration                                | ✅     |
| T03  | `maintainOutboxPartitions` — create-ahead + opt-in retention-drop                              | ✅     |

Plus this consolidation pass itself: an end-to-end architecture doc with a
sequence diagram, an operational runbook (10 procedures), a focused
security review (3 tracked P2 findings, no P0/P1), an observability
contract (metrics/logs vocabulary, mostly not-yet-wired — recorded
honestly), a health/readiness JSON contract written ahead of T23, and
real runnable benchmark scaffolding for all six hot paths (see
[outbox-benchmark-methodology.md](../../quality/architecture-benchmarks/outbox-benchmark-methodology.md)).

## 2. Test & verification summary

144 unit + 40 integration tests in `@corestack/platform` (280 total
repo-wide), all green at every commit boundary this epic, verified against
real Postgres via Testcontainers, never mocked. Full workspace
verification (lint, typecheck, test, build, format:check, CI guards,
architecture fitness) green at every commit. Three real production-class
bugs were caught by this epic's own test-driven loop before shipping
(partition-bound timezone parsing, jsonb payload round-trip, a
test-isolation leak) — see
[e03-outbox-epic.md](../lessons/e03-outbox-epic.md) for the full lessons.

## 3. Package scorecard (informal — outbox subsystem only)

The formal, dated architecture-benchmark report this repository's own
convention calls for arrives at actual E03 exit, alongside the full
health report. This is an informal interim scorecard for the outbox
subsystem specifically, so the consolidation pass leaves _something_
concrete behind rather than nothing:

| Dimension           | Assessment                                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Testability**     | High — every component has both pure-domain unit coverage and real-Postgres integration coverage; crash-consistency has its own dedicated adversarial suite                                                             |
| **Maintainability** | High — one component spec per module (contract, failure modes, concurrency, security, observability, testing, design rationale); shared `ISql`/DDL-extraction patterns avoid duplication across T11/T12/T14 and T10/T03 |
| **Documentation**   | High as of this consolidation pass — architecture map, runbook, security review, observability contract, and health contract now exist where none did before; component specs pre-existed per-task                      |
| **Performance**     | **Unmeasured until now** — this consolidation pass adds the first real, runnable baseline (see §4); no CI-gated budget exists yet (E04-T13)                                                                             |
| **Security**        | Reviewed — no P0/P1; 3 P2 hardening items tracked (checkpoint-table privilege separation, no per-handler timeout, no admin-action audit log), none externally exploitable                                               |
| **API stability**   | Stable within this epic — no public export has changed shape since it shipped; `./postgres` subpath additions are additive only                                                                                         |

## 4. Benchmark scaffolding (no baseline captured yet)

Real, runnable benchmark scripts now exist for all six named hot paths
(`writeOutboxEvents`, relay polling, relay dispatch, checkpoint updates,
processed-event inserts, partition maintenance), each backed by real
Postgres via Testcontainers (except the in-memory relay-dispatch
isolation benchmark) — verified to typecheck and lint clean. See
[outbox-benchmark-methodology.md](../../quality/architecture-benchmarks/outbox-benchmark-methodology.md)
for full methodology.

**No baseline numbers exist yet.** The first run was attempted during
this consolidation pass and had to be abandoned mid-run: this machine's
Docker Desktop installation became unavailable (binary and service both
gone, install directory left in a `tmp-delete` state) partway through.
This is flagged separately to the founder as an environment blocker (see
§5). `docs/quality/architecture-benchmarks/baselines/outbox/` does not
exist until a run completes successfully. No thresholds are set and no CI
gate exists — both remain deferred to E04-T13 regardless of when a
baseline is first captured.

## 5. Known risks and open items carried forward

| Item                                                                                                                                                                                                                                                                              | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `outbox_backlog_size` has no computable source today                                                                                                                                                                                                                              | Flagged in both [health-contract.md](../../platform/health-contract.md) and [outbox-observability.md](../../platform/outbox-observability.md) — T23 must decide whether to add `OutboxRelayStore.countBacklog` or ship on lag alone                                                                                                                                                                                                                                                              |
| 3 P2 security findings (checkpoint privilege, handler timeout, admin audit log)                                                                                                                                                                                                   | Tracked in [outbox-review.md](../../security/outbox-review.md); none blocking, none externally exploitable                                                                                                                                                                                                                                                                                                                                                                                       |
| Section 7's task order names T41/T42/T43 as "Real UnitOfWork / Adapter integration / End-to-end certification," but the approved blueprint ([01-foundation.md](../01-foundation.md)) defines them as RateLimiter adapter / CachePort / Idempotency-key-store adapter respectively | **Not yet reconciled.** Per Reconciliation Authority, this does not block T23/T30/T31/T33/T40 — it only becomes actionable once T40 (shared Postgres base) is done and T41 is next up. Will be surfaced explicitly at that point, with an ADR if the resolution isn't purely mechanical.                                                                                                                                                                                                         |
| Observability contract is mostly not-yet-implemented (only relay lag is live)                                                                                                                                                                                                     | By design — see outbox-observability.md's "what is live today vs. contract-only" section; the next contributor touching the relay or partition maintenance should wire at least one more signal rather than let the gap persist indefinitely                                                                                                                                                                                                                                                     |
| **This machine's Docker Desktop installation became unavailable mid-pass** (binary and service both gone, install directory left in a `tmp-delete` state) while attempting the first benchmark run                                                                                | **Blocking, external, requires founder action** — same class of stop condition as the E03 entry review's original Docker-absence blocker. No Postgres-backed work (benchmarks now, and T23/T30/T31/T33/T40's own integration tests next) can be verified on this machine until Docker Desktop is reinstalled/repaired. It is not yet known whether this was triggered by an in-session `docker desktop restart` command or an unrelated concurrent update — stated honestly rather than guessed. |

## 6. Infrastructure maturity score: 74/100

Scored per Platform Maturity Mode's own dimensions, derived from the
facts above rather than asserted:

| Dimension                                                                                                  | Score | Basis                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract completeness (spec, failure modes, concurrency, security, observability documented per component) | 18/20 | Every shipped component has a full spec; observability contract exists but is mostly aspirational (−2)                                                                                                                                                             |
| Test rigor (real-dependency proof, not mocked; adversarial cases covered)                                  | 18/20 | 40 integration tests against real Postgres, dedicated crash-consistency suite; no port-level contract-test suite yet since E04-T01 doesn't exist yet (−2)                                                                                                          |
| Operational readiness (runbook, health/readiness contract)                                                 | 14/20 | Runbook covers all 10 requested procedures with real SQL/API, but several procedures (replay, admin-action logging) are manual-only, no tooling yet (−6)                                                                                                           |
| Security posture                                                                                           | 15/20 | Reviewed with 0 P0/P1; 3 tracked P2s are real, if minor, gaps not yet closed (−5)                                                                                                                                                                                  |
| Performance visibility                                                                                     | 4/20  | Real, typechecked, lint-clean benchmark scripts exist for all six hot paths, but **zero baseline measurements exist** — the first run was blocked mid-execution by this machine's Docker outage (−16)                                                              |
| Documentation coherence                                                                                    | 5/10  | Architecture map, runbook, and contracts newly consolidated and cross-linked; not yet reviewed by a second person, and one stale cross-reference (E03-entry-review's runbook path) was only caught during this same pass, suggesting more may exist elsewhere (−5) |

**74/100 total.** The dimension holding the score back most is
performance visibility: the scaffolding is real, but a benchmark that has
never produced a number is scaffolding, not evidence, and the score
reflects that plainly rather than crediting work-in-progress as done.
Operational tooling maturity is the second-largest gap (the runbook is
honest and complete as documentation, but several procedures still
require manual SQL rather than a built API — e.g. replay). Neither is a
regression: this consolidation pass exists specifically to convert
unstated assumptions into documented, scored gaps so the next phase of
work has an accurate starting point rather than an inflated one. This
score should be revisited once (a) Docker Desktop is restored and a real
baseline is captured, and (b) whatever caused the Docker outage is
understood.

## 7. Next — blocked on Docker

Per the founder's Section 7 ordering, the queue is: T23 (Health/Readiness)
→ T30 (RLS harness) → T31 (Repository base) → T33 (Purge protocol) → T40
(Shared Postgres base) → T41-T43 (label conflict above to be surfaced when
reached). **Every one of these is Postgres-backed** — T23's readiness
checks need real database/migration-state reads, T30/T31/T33/T40 are
RLS/repository/Postgres-adapter work by definition. Per the E03 entry
review's own standing rule ("Postgres-backed tasks are implemented only
when local verification is possible — CI-only verification of DB code
rejected as inadequate feedback"), none of them can be started to this
project's standard while Docker is unavailable on this machine.

This consolidation pass is otherwise complete and committed. Resuming at
T23 is queued behind the founder restoring Docker Desktop — this is a
stop condition, not a task to work around.
