# CoreStack Quality Dashboard

> **Maintained automatically** — updated at every epic exit, milestone exit,
> and remediation batch (governance §7.3). Numbers are from real runs, never
> estimated. Last update: **2026-07-29** (E03 in progress: outbox epic
> T02-T03, T10-T14 done; Infrastructure Consolidation pass complete;
> migrated local dev/test to PostgreSQL 18 — see
> [postgres-18-compatibility.md](../platform/postgres-18-compatibility.md);
> T23 health/readiness done — see
> [health-readiness.md](../../packages/platform/docs/health-readiness.md)).

## Standing policy

**No new features while unresolved P0 findings exist.** (Governance §7.4 —
anchored here; also stated in CONTRIBUTING.) Current P0 count is the gate.
**Platform Maturity Mode is active:** the kernel is stability-first; every
infrastructure component built from E03 onward ships as a documented
product (contract, failure modes, retry/timeout/cancellation, concurrency,
performance, security, observability scoping) — see
[packages/platform/docs/migration-loader.md](../../packages/platform/docs/migration-loader.md)
for the first instance of this standard.

## Findings

| Severity | Open                      | Resolved | Notes                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | **0**                     | 4        | AUD-01…04 — see [remediation log](remediation-log.md)                                                                                                                                                                                                                                 |
| **P1**   | 1 _(scheduled by design)_ | 6        | AUD-07 is a _decision deferred to E06 design_ (auth limiter algorithm), not an unfixed defect                                                                                                                                                                                         |
| **P2**   | 9 _(6 mapped + 3 new)_    | 2        | AUD-12→E01-T02.4, AUD-13 done, AUD-14/15/16/18/19 tracked; **+3 new** from the outbox security review — checkpoint-table privilege separation, no per-handler timeout, no admin-action audit log (none externally exploitable — see [outbox-review.md](../security/outbox-review.md)) |

## Test & coverage

| Metric               | Value                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Test files / tests   | 42 files / **315 tests** (kernel 66 · lint fixtures 14 · architecture fitness 16 · platform 171 unit + 48 integration) |
| Kernel coverage (v8) | **97.7% stmts · 98.2% branch · 90.7% funcs** (target ≥90% domain/application — met)                                    |
| Platform coverage    | Not yet measured — arrives with the coverage-gate task (E04-T11)                                                       |
| Coverage CI gate     | Not yet enforced (E04-T11) — tracked, honest                                                                           |
| Unit-suite duration  | ~1 s repo-wide on cache hit (budget < 30 s)                                                                            |

## Architecture & API

| Metric                      | Value                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| ADRs accepted               | **16** (0001–0016)                                                                                                                           |
| Architecture fitness tests  | **Live in CI**: layer boundaries (lint zones + fixtures), import cycles, cross-package boundaries, manifest/ADR compliance, kernel zero-deps |
| Public API stability        | Kernel runtime surface snapshot-gated; full type-level report at E19-T14                                                                     |
| Kernel runtime dependencies | **0** (fitness-test-enforced)                                                                                                                |

## CI health

| Gate                  | Status                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Silent-success guards | ✅ `assert-turbo-tasks` on `test` (min 3) and `test:integration` (exact manifest — now non-trivially exercised: `@corestack/platform`)                                        |
| Integration lane      | ✅ Live: Testcontainers-based in CI (no fixed service container needed); dual-mode locally — a local Postgres via `DATABASE_URL` or Testcontainers, same test code either way |
| Actions supply chain  | ✅ All actions SHA-pinned; Renovate `pinDigests` maintains                                                                                                                    |
| Release pipeline      | ⏸ Gated on `RELEASE_ENABLED` repo variable (awaiting npm org + token — external)                                                                                              |
| Dependency audit      | Scheduled lane (weekly + main), not PR-blocking (AUD-13 rationale)                                                                                                            |

## Benchmarks

Kernel hot paths: none yet — harness arrives E04-T13; hot-path budgets
(≤5 ms session/policy p95) become CI-gated then.

**Outbox subsystem:** first real baseline captured 2026-07-28 against a
local PostgreSQL 18.4 instance — six scripts under
`packages/platform/bench/` (`writeOutboxEvents` 4.24ms mean, relay
polling 4.80ms, relay dispatch 0.95ms in-memory, checkpoint updates
1.66ms, processed-event inserts 1.39ms, partition maintenance 3.56ms).
**Not CI-gated, no thresholds** — same posture as the kernel, deferred to
E04-T13. See
[outbox-benchmark-methodology.md](architecture-benchmarks/outbox-benchmark-methodology.md)
and [baselines/outbox/](architecture-benchmarks/baselines/outbox/).

## Technical debt register (must be zero or justified)

| Item                                                               | Justification                                                                                              | Retires at           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------- |
| Type-level API report deferred                                     | Runtime snapshot covers surface pre-1.0; api-extractor tooling costs unjustified before freeze             | E19-T14              |
| Coverage not CI-gated                                              | Gate lands with the test-infrastructure epic                                                               | E04-T11              |
| `/contracts` types-only rule enforced structurally, not type-level | Fitness test blocks runtime deep-imports; full types-only proof needs the first contracts subpath to exist | E01-T02.4 (E05 gate) |

## Documentation coverage

All 16 ADRs current · design docs (architecture/database/api) versioned ·
5 guide structures approved · overview.md reconciled (AUD-11) ·
docs drift-check joins every epic-exit checklist (AUD-19). Outbox
subsystem consolidated (2026-07-28): end-to-end architecture map with
sequence diagram, operational runbook, security review, observability
contract, and health/readiness contract — see
[E03-outbox-milestone-report.md](../engineering/reviews/E03-outbox-milestone-report.md)
for the full index. Two stale cross-references caught and fixed in the
same pass (E03-entry-review.md's runbook path; several component specs'
Testcontainers-only test framing, once local Postgres 18 became a second
mode). PostgreSQL 18 compatibility verified empirically — see
[postgres-18-compatibility.md](../platform/postgres-18-compatibility.md).

## Infrastructure maturity

**83/100** as of the outbox-epic Infrastructure Consolidation pass
(2026-07-28, revised after a real benchmark baseline was captured) —
scored per-dimension (contract completeness, test rigor, operational
readiness, security posture, performance visibility, documentation
coherence) in
[E03-outbox-milestone-report.md §6](../engineering/reviews/E03-outbox-milestone-report.md).
Scope: the outbox subsystem only, not all of E03 or the whole platform
package. Held back mainly by operational tooling maturity (runbook
procedures like replay are manual SQL, not yet a built API) and
performance visibility (real baseline now exists, but single-machine and
unthresholded).
