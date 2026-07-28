# CoreStack Quality Dashboard

> **Maintained automatically** — updated at every epic exit, milestone exit,
> and remediation batch (governance §7.3). Numbers are from real runs, never
> estimated. Last update: **2026-07-28** (E03 in progress: T01 complete).

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

| Severity | Open                        | Resolved | Notes                                                                                                  |
| -------- | --------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| **P0**   | **0**                       | 4        | AUD-01…04 — see [remediation log](remediation-log.md)                                                  |
| **P1**   | 1 _(scheduled by design)_   | 6        | AUD-07 is a _decision deferred to E06 design_ (auth limiter algorithm), not an unfixed defect          |
| **P2**   | 6 _(mapped into blueprint)_ | 2        | AUD-12→E01-T02.4 (partially covered by fitness tests already), AUD-13 done, AUD-14/15/16/18/19 tracked |

## Test & coverage

| Metric               | Value                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| Test files / tests   | 24 files / **189 tests** (kernel 66 · lint fixtures 14 · architecture fitness 16 · platform 93) |
| Kernel coverage (v8) | **97.7% stmts · 98.2% branch · 90.7% funcs** (target ≥90% domain/application — met)             |
| Platform coverage    | Not yet measured — arrives with the coverage-gate task (E04-T11)                                |
| Coverage CI gate     | Not yet enforced (E04-T11) — tracked, honest                                                    |
| Unit-suite duration  | ~1 s repo-wide on cache hit (budget < 30 s)                                                     |

## Architecture & API

| Metric                      | Value                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| ADRs accepted               | **15** (0001–0015)                                                                                                                           |
| Architecture fitness tests  | **Live in CI**: layer boundaries (lint zones + fixtures), import cycles, cross-package boundaries, manifest/ADR compliance, kernel zero-deps |
| Public API stability        | Kernel runtime surface snapshot-gated; full type-level report at E19-T14                                                                     |
| Kernel runtime dependencies | **0** (fitness-test-enforced)                                                                                                                |

## CI health

| Gate                  | Status                                                                            |
| --------------------- | --------------------------------------------------------------------------------- |
| Silent-success guards | ✅ `assert-turbo-tasks` on `test` (min 3) and `test:integration` (exact manifest) |
| Actions supply chain  | ✅ All actions SHA-pinned; Renovate `pinDigests` maintains                        |
| Release pipeline      | ⏸ Gated on `RELEASE_ENABLED` repo variable (awaiting npm org + token — external)  |
| Dependency audit      | Scheduled lane (weekly + main), not PR-blocking (AUD-13 rationale)                |

## Benchmarks

None yet — harness arrives E04-T13; hot-path budgets (≤5 ms session/policy
p95) become CI-gated then. History table starts with the first run.

## Technical debt register (must be zero or justified)

| Item                                                               | Justification                                                                                              | Retires at           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------- |
| Type-level API report deferred                                     | Runtime snapshot covers surface pre-1.0; api-extractor tooling costs unjustified before freeze             | E19-T14              |
| Coverage not CI-gated                                              | Gate lands with the test-infrastructure epic                                                               | E04-T11              |
| `/contracts` types-only rule enforced structurally, not type-level | Fitness test blocks runtime deep-imports; full types-only proof needs the first contracts subpath to exist | E01-T02.4 (E05 gate) |

## Documentation coverage

All 15 ADRs current · design docs (architecture/database/api) versioned ·
5 guide structures approved · overview.md reconciled (AUD-11) ·
docs drift-check joins every epic-exit checklist (AUD-19).
