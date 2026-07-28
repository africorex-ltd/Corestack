# Epic Entry Review — E03 Platform Infrastructure

- **Date:** 2026-07-28 · **Mode:** Platform Maturity (governance §13)
- **Epic:** E03 — migration engine, transactional outbox, composition root,
  tenant-isolation infrastructure, shared Postgres adapter base (24 tasks).

## 1. ADR review (relevant set)

| ADR                                  | Bearing on E03                                                                                          | Compliance plan                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0002 (monorepo)                      | new `@corestack/platform` package joins `packages/*`                                                    | manifest fitness rules apply from first commit                                                                  |
| 0004 (Postgres/Drizzle behind ports) | Drizzle base (T40) is the reference adapter, never leaks upward                                         | port-first task ordering; contract suites at E04                                                                |
| 0008 (pooled tenancy)                | RLS harness (T30) + org-scoped repo utilities (T31) implement the backstop layers                       | isolation suite wiring is a task AC, not an afterthought                                                        |
| 0009 (outbox)                        | T10–T14 are its implementation; kernel reference semantics (post AUD-02/03) are the behavioral contract | crash-consistency suite (T13) locks it                                                                          |
| 0014 (lifecycle contract)            | T20/T21 implement `create<X>Module` + `createCoreStack()`                                               | conformance checker is part of T20's AC                                                                         |
| 0015 (N/N+1 upgrades)                | migration engine (T01–T04) must make expand-and-contract mechanical                                     | header metadata + forward-only rules in the format itself                                                       |
| Kernel RC certification              | kernel surface is now stability-first (maturity §2)                                                     | E03 consumes kernel ports; any kernel change found necessary triggers the §2 questionnaire in `docs/decisions/` |

## 2. Dependency review

- **Upstream:** kernel RC ✅ (all consumed ports certified); tooling baseline ✅;
  CI truth-guards ✅ (integration manifest awaits its first entry — E03-T02's AC).
- **New runtime dependencies expected:** `zod` (config validation, ADR-0005 —
  arrives T22), `drizzle-orm` + `postgres` driver (T40, reference adapter,
  optional-peer pattern per ADR-0010). Each lands with written justification;
  platform's max-dependency budget: **≤ 4 runtime deps** (recorded in the
  package scorecard).
- **Environment:** ⛔ **Docker absent on the dev machine** — external stop
  condition for T02(integration)/T03/T10–T14/T30/T40–T43. Docker-independent
  tasks (T01, T20–T24 core logic) proceed; Postgres-backed tasks are
  implemented only when local verification is possible (CI-only verification
  of DB code rejected as inadequate feedback). **Founder action: install
  Docker Desktop (or provide a reachable Postgres 16 + `DATABASE_URL`).**

## 3. Architecture-rule verification

Fitness suite green at entry (cycles/cross-package/manifest); lint zones
active; kernel export snapshot current; no open P0 (dashboard). New-package
justification (maturity §11.4) recorded in
[docs/decisions/0001](../../decisions/0001-platform-package.md): the kernel
cannot own fs/SQL-touching infrastructure (runtime-agnostic charter), and no
other package exists — `@corestack/platform` is warranted.

## 4. Maturity-mode obligations mapped

Every E03 component ships with: component spec (contract, failure modes,
retry/timeout/cancellation, concurrency, performance, security) under
`packages/platform/docs/`; observability via kernel Logger/metrics hooks +
correlation propagation; runbook sections accreting into
`docs/runbooks/platform.md`; benchmarks joining E04-T13's harness. The epic
exits with an Engineering Health Report + lessons-learned.

**Verdict: ENTER.** Sequenced start: T01 (loader, pure) → T20–T22
(lifecycle/composition/config, in-memory-testable) → Postgres-backed set
once the environment blocker clears.
