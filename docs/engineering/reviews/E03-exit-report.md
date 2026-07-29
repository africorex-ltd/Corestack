# E03 — Engineering Health Report (Epic Exit)

- **Date:** 2026-07-29 · **Mode:** Platform Maturity (governance §13)
- **Scope of this report:** the full E03 epic
  ([01-foundation.md](../01-foundation.md) F3.1–F3.5), superseding
  [E03-outbox-milestone-report.md](E03-outbox-milestone-report.md), which
  was explicitly scoped as a mid-epic checkpoint for the outbox subsystem
  only. This is the Engineering Health Report the
  [entry review](E03-entry-review.md) promised at epic exit.

## 1. What shipped

| Task | What                                                                                           | Status                   |
| ---- | ---------------------------------------------------------------------------------------------- | ------------------------ |
| T01  | Migration format & loader                                                                      | ✅                       |
| T02  | `platform.module_migrations` runner (advisory-lock serialized, chain-checksum drift detection) | ✅                       |
| T03  | `maintainOutboxPartitions` — create-ahead + opt-in retention-drop                              | ✅                       |
| T04  | Migration authoring guide (expand-and-contract patterns, CONCURRENTLY rules)                   | **❌ Not done — see §5** |
| T10  | Outbox schema bootstrap                                                                        | ✅                       |
| T11  | `writeOutboxEvents`/`createOutboxStaging`                                                      | ✅                       |
| T12  | `OutboxRelay` — per-consumer checkpointed polling relay                                        | ✅                       |
| T13  | Crash-consistency proof suite                                                                  | ✅                       |
| T14  | `PostgresProcessedEventStore` + idempotent-consumer integration                                | ✅                       |
| T20  | Module lifecycle contract types + conformance checker                                          | ✅                       |
| T21  | `createCoreStack()` composition helper                                                         | ✅                       |
| T22  | Config validation framework                                                                    | ✅                       |
| T23  | Health/readiness computation                                                                   | ✅                       |
| T24  | Graceful shutdown orchestration                                                                | ✅                       |
| T30  | RLS harness / tenant isolation                                                                 | ✅                       |
| T31  | Org-scoped repository base utilities                                                           | ✅                       |
| T32  | Context resolution middleware spec                                                             | ✅                       |
| T33  | Purge protocol framework                                                                       | ✅                       |
| T40  | `PostgresUnitOfWork` (ADR-0017: Drizzle deferred)                                              | ✅                       |
| T41  | `PostgresRateLimiter` adapter                                                                  | ✅                       |
| T42  | `CachePort` decision note (ADR-0018: no Postgres backend, Redis deferred)                      | ✅                       |
| T43  | `PostgresIdempotencyStore` adapter (ADR-0019: `IdempotencyStore` added to kernel)              | ✅                       |

**21 of 22 tasks complete.** All tasks in the founder's confirmed Section 7
execution order (T23 → T30 → T31 → T33 → T40 → T41 → T42 → T43) are done,
alongside every earlier F3.1–F3.3 task. T04 (a documentation-only task, not
in the Section 7 sequence) was never picked up — see §5.

## 2. Test & verification summary

**375 tests across 51 files, all green** at every commit boundary this
epic: kernel 74 (was 66 at epic start — 8 new for `IdempotencyStore`),
lint-config fixtures 14, architecture fitness 16, platform 191 unit + 80
integration (was 144 unit + 40 integration at the outbox-epic checkpoint).
Full workspace verification (lint, typecheck, test, build, format:check,
CI silent-success guards, architecture fitness) green at every commit — no
task shipped with a failing gate. All Postgres-backed work verified
against real PostgreSQL (local PG18 or Testcontainers, dual-mode bootstrap
per [postgres-18-compatibility.md](../../platform/postgres-18-compatibility.md)),
never mocked.

## 3. Architecture changes this epic

Four ADRs added since the outbox-epic checkpoint (which stood at 0016):

| ADR  | Decision                                                     | Why it exists                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0017 | Drizzle deferred to the first module repository adapter      | T40's blueprint row was titled "Drizzle base setup," but T40's actual needs (transaction scoping, atomic event staging) are fully served by the raw `postgres` driver; ADR-0004 already approved Drizzle, this only schedules it |
| 0018 | No Postgres-backed cache; Redis `CachePort` adapter deferred | E02-T07 already shipped the in-memory reference; Postgres was never a candidate cache backend (no table in DB §3); Redis needs a dependency no ADR has approved and Testcontainers verification unavailable on this machine      |
| 0019 | `IdempotencyStore` added to the kernel                       | E03-T43's blueprint row assumed a kernel port that no E02 task ever created — E04-T03 already lists it alongside `Cache`/`RateLimiter`/`Encrypter`/`UnitOfWork`/`EventBus`, so the gap was filled rather than routed around      |

Plus one structural extension inside T40: `PostgresTransactionContext
extends TransactionContext` adds `sql: TransactionSql` — kernel's
`TransactionContext` gave a use case no way to reach its own open
transaction for repository calls, only `.publish()`. Verified additive via
`tsc --noEmit` (still satisfies `implements UnitOfWork` through
contravariant parameter widening).

## 4. Known risks and tracked debt

| Item                                                                                                                                                                                                                                            | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Platform's own tables have no tracked-migration history** — `ensureOutboxSchema`, `ensureRateLimitsSchema`, `ensureIdempotencyKeysSchema` all bootstrap via application-code `CREATE TABLE IF NOT EXISTS`, not through T02's migration runner | Real, coherent gap named at epic exit rather than mid-task: T02 gives every _module's_ schema checksum drift detection and ordered history; the platform package's own tables get none of that for themselves. No incident yet — these tables haven't changed shape since shipping — but a future column addition to any of them has no forced-ordering or drift-detection mechanism. **No retirement task assigned yet**; candidate for E04 or whenever platform's own schema needs its first change. |
| E03-T04 (migration authoring guide) never built                                                                                                                                                                                                 | Genuine gap, not a silent scope cut — discovered during this exit pass by cross-checking the blueprint against what's shipped. Low complexity (S/1d, DOC category), not blocking any other epic. Tracked, not scheduled.                                                                                                                                                                                                                                                                               |
| 3 P2 security findings from the outbox review (checkpoint-table privilege separation, no per-handler timeout, no admin-action audit log)                                                                                                        | Unchanged since the outbox-epic checkpoint — see [outbox-review.md](../../security/outbox-review.md). None externally exploitable, none newly introduced this epic.                                                                                                                                                                                                                                                                                                                                    |
| Docker/Testcontainers unavailable on this dev machine                                                                                                                                                                                           | Resolved-around, not fixed, since the outbox epic (local PostgreSQL 18 via `DATABASE_URL`). Still blocks anything that specifically requires Testcontainers-only infrastructure — named explicitly in ADR-0018 (Redis adapter verification) and relevant again for E04-T02 (Testcontainers harness itself).                                                                                                                                                                                            |
| Real per-role login credentials for the `NOLOGIN` app/platform roles (T30/T31) still undecided                                                                                                                                                  | Explicitly restated, not resolved, in T40's spec — deployment configuration, not this package's code to encode. Still open, tracked in [unit-of-work.md](../../packages/platform/docs/unit-of-work.md).                                                                                                                                                                                                                                                                                                |
| Coverage not CI-gated; type-level API report deferred                                                                                                                                                                                           | Unchanged from before this epic — both tracked in [dashboard.md](../../quality/dashboard.md)'s technical debt register with retirement targets (E04-T11, E19-T14).                                                                                                                                                                                                                                                                                                                                     |

No open P0 findings. No unresolved architectural conflicts — the one
flagged mid-epic (Section 7 prose vs. blueprint definitions for
T41/T42/T43) was resolved directly by the founder via `AskUserQuestion`
("follow the blueprint literally") before T41 began.

## 5. Infrastructure maturity score: 79/100 (whole-epic re-score)

The outbox-epic checkpoint scored **83/100**, but that score's own scope
line said "outbox subsystem only, not all of E03." Re-scored here across
every component E03 shipped — RLS/org-scoping, composition root,
health/readiness, graceful shutdown, and the four Postgres adapters
(UnitOfWork, RateLimiter, Cache decision, IdempotencyStore), not just the
outbox pipeline:

| Dimension                                                                                                  | Score | Basis                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract completeness (spec, failure modes, concurrency, security, observability documented per component) | 19/20 | Every shipped component has a full spec, including this epic's two decision-note-only tasks (T42) and two-real-bugs-caught adapter (T43); T04's guide gap costs nothing here (it's about DB §18 patterns, not component specs) but is noted (−1) since the epic's own docs commitment is incomplete     |
| Test rigor (real-dependency proof, not mocked; adversarial cases covered)                                  | 18/20 | 80 real-Postgres integration tests epic-wide, several with genuine multi-connection concurrency proofs (T30's role-switching, T31's real app-role connection, T41's 20-caller race, T43's 2-connection + 20-caller race); no port-level shared contract-test suite yet since E04-T01 doesn't exist (−2) |
| Operational readiness (runbook, health/readiness contract)                                                 | 14/20 | Health/readiness (T23) and graceful shutdown (T24) are real, tested components — a genuine advance over the outbox-epic checkpoint's paper-only contract. Still no built tooling for replay/admin actions (unchanged debt) (−6)                                                                         |
| Security posture                                                                                           | 16/20 | 0 P0/P1 across the whole epic; RLS harness (T30) and org-scoped repository (T31) close real tenant-isolation gaps with fail-loud-verified behavior; 3 tracked P2s from the outbox review remain (−4)                                                                                                    |
| Performance visibility                                                                                     | 13/20 | Real baseline exists for outbox hot paths only (2026-07-28); T30/T31/T33/T40/T41/T43's Postgres operations are proven correct under concurrency but not benchmarked — unmeasured, not unknown-risk, pending E04-T13 (−7)                                                                                |
| Documentation coherence                                                                                    | 6/10  | Every shipped task has a component spec, cross-linked from the platform README; this exit pass itself caught two stale docs (outbox-architecture.md's T40 status, a stale code comment) and one never-built doc task (T04) — the drift-catching process is working, but drift kept recurring (−4)       |

**79/100 total.** Lower than the outbox-epic checkpoint's 83 not because
anything regressed, but because that score covered a narrower, more
mature slice; this score honestly represents the wider surface E03 as a
whole now has to carry, most of it new construction (RLS, composition
root, three Postgres adapters, a decision note, and a kernel port
addition) built to the same rigor but not yet weathered by real use the
way the outbox pipeline was at that checkpoint.

## 6. Process notes worth carrying into E04

See [e03-tenant-isolation-and-adapters.md](../lessons/e03-tenant-isolation-and-adapters.md)
for the full lessons-learned writeup. Headline: a **pre-implementation
empirical-verification pass** (write a throwaway script against real
Postgres before writing production code) caught three real bugs this
epic before they shipped — a GUC-scoping surprise (T30), a
lexicographic-comparison bug from untyped bind parameters (T41), and a
Clock-vs-SQL-`now()` divergence (T43). This is now an established,
repeatable practice worth keeping for E04's port-contract-suite work,
which will exercise exactly these kinds of Postgres-adapter edge cases at
scale.

## 7. Next

E04 — Testing Infrastructure (contract-suite framework, Testcontainers
harness, port contract suites, cross-tenant isolation suite framework) is
next per the blueprint's own epic order. **E04-T02 (Testcontainers harness
for Postgres/Redis/MinIO) has the same environmental blocker documented in
ADR-0018: this dev machine has no Docker.** That is a new-epic-entry
consideration, not a continuation of E03's own task list, and is called
out here rather than started autonomously.
