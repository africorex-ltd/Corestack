# CoreStack Quality Dashboard

> **Maintained automatically** — updated at every epic exit, milestone exit,
> and remediation batch (governance §7.3). Numbers are from real runs, never
> estimated. Last update: **2026-07-30** — **E05-T04 (`Membership` domain
> model) complete**: the second real business aggregate, following
> `Organization` (E05-T02)'s modelling standard exactly. `MembershipId`
> (own value object), `OrganizationId` (reused, not reimplemented), and a
> temporary tenancy-local `UserId` value object (no shared identity module
> exists in this repo — confirmed by search, flagged for deletion once one
> does). `MembershipRole` (`OWNER`/`ADMIN`/`MEMBER`) and `MembershipStatus`
> (`ACTIVE`/`SUSPENDED`/`REMOVED`, `REMOVED` terminal), each with its own
> transition table. Explicit methods (`create`/`promoteToAdmin`/
> `demoteToMember`/`suspend`/`reactivate`/`remove`), domain events
> collected via `pullDomainEvents()`/`clearDomainEvents()` — same local
> pattern as `Organization`, no shared `AggregateRoot`. Owner is
> structurally locked against promotion/demotion (role transition table
> has no outgoing `OWNER` entries) and against removal (`remove()` checks
> the role explicitly before the status table) — ownership transfer is an
> explicitly open future use case. Full detail:
> [membership-domain.md](../modules/membership-domain.md). Tenancy package
> tests 94→171 (+77 — 75 across 5 new files, +2 backfilled into the
> existing `index.test.ts` smoke test, one of which covers E05-T03's
> `createOrganization` export that task's own update missed; 8→13 files).
> Full build/typecheck/lint/test/
> architecture-fitness/export-snapshot gate green repo-wide
> (architecture-fitness unchanged at 36). Mechanically updated
> `MembershipRepository` to return `Membership` instead of the superseded
> `MembershipRecord` placeholder — the same forced fix
> `OrganizationRepository` went through in E05-T02. Prior update:
> **E05-T03 (`createOrganization` use case) complete**: the first real
> application service in `@corestack/tenancy` — coordinates the
> `Organization` aggregate, `OrganizationRepository`, and `UnitOfWork`
> event publication; contains no domain rules of its own.
> `CreateOrganizationCommand`/`CreateOrganizationResult` (a DTO, never the
> aggregate), `DuplicateSlugError`. Whole flow (uniqueness check,
> aggregate creation, persistence, event publication) runs inside one
> `UnitOfWork.run()` call; depends on the generic kernel `UnitOfWork`, not
> `PostgresUnitOfWork` — no infrastructure coupling. Full detail:
> [create-organization-usecase.md](../modules/create-organization-usecase.md).
> Tenancy package tests 79→94 (+15; 7→8 files). Fixed
> `OrganizationCreatedPayload` (E05-T01): dropped the `kind` field, which
> the `Organization` aggregate has no equivalent of and could never
> actually supply — the wire contract follows the domain model, not the
> reverse. Two things flagged, not resolved: `existsBySlug` is a
> best-effort duplicate check, not a durable uniqueness guarantee, until
> E05-T21 adds a unique index; and `requestedBy`/`requestId` are validated
> but not yet consumed (no owner `Membership` created, no idempotency
> wiring) — both are `createOrganization`'s own non-goals, not silent
> gaps. Prior update: **E05-T02 (Organization domain model)
> complete**: pure domain aggregate — `OrganizationId`/`OrganizationSlug`
> value objects, `OrganizationStatus` (3 states, `DELETED` terminal),
> explicit methods (`create`/`rename`/`suspend`/`reactivate`/`delete`),
> domain events collected via `pullDomainEvents()`/`clearDomainEvents()`.
> Superseded the E05-T01 placeholder `OrganizationRecord`. One open
> reconciliation flagged, not resolved: this task's 3-state status model
> and no `kind` field vs. `tenancy-contract.md`'s 4-state
> (`pending_deletion`/`purged`) blueprint reference — tracked in
> organization-domain.md's non-goals for whichever future task
> (E05-T13/T21) needs to decide. Prior update:
> **E05-T01 (Tenancy module scaffold) complete**: new `@corestack/tenancy`
> package — module factory, 3 repository ports (contract-only), event
> contracts, a `ModuleConfigSpec` with defaults, a schema-only migration.
> Found and documented one confirmed platform-framework limitation along
> the way (`ModuleConfigSpec<T>` cannot express an optional or coerced
> config field under this repo's `exactOptionalPropertyTypes`) — resolved
> module-locally, recorded in
> [e05-readiness-friction-log.md](../engineering/e05-readiness-friction-log.md).
> Prior update: **E05 Readiness Gate complete,
> verdict GO** (full report:
> [e05-readiness-gate-report.md](../engineering/e05-readiness-gate-report.md);
> friction log:
> [e05-readiness-friction-log.md](../engineering/e05-readiness-friction-log.md);
> tenancy contract:
> [tenancy-contract.md](../modules/tenancy-contract.md); alpha release prep
> under `docs/releases/v0.1.0-alpha.1-*`, prepared not published). Export-
> surface snapshot gap closed (5/5 conditions gated); 3 of 4 previously-
> unproven contract suites gained mutation proof (`UnitOfWork` deliberately
> deferred, reasoned); `CONTRIBUTING.md` now links the mandatory tenant-
> safety guide and corrects a stale Docker-only integration-test claim.
> Prior update: **2026-07-29** (**E03 COMPLETE** — 21 of 22 tasks;
> outbox epic T02-T03, T10-T14 done; Infrastructure Consolidation pass complete;
> migrated local dev/test to PostgreSQL 18 — see
> [postgres-18-compatibility.md](../platform/postgres-18-compatibility.md);
> T23 health/readiness done — see
> [health-readiness.md](../../packages/platform/docs/health-readiness.md);
> T30 RLS harness done — see
> [tenant-isolation.md](../../packages/platform/docs/tenant-isolation.md);
> T31 org-scoped repository base done — see
> [org-scoped-repository.md](../../packages/platform/docs/org-scoped-repository.md);
> T33 purge protocol framework done — see
> [purge-protocol.md](../../packages/platform/docs/purge-protocol.md);
> T40 Postgres UnitOfWork done (ADR-0017: Drizzle deferred) — see
> [unit-of-work.md](../../packages/platform/docs/unit-of-work.md);
> T41 Postgres RateLimiter done — see
> [rate-limiter.md](../../packages/platform/docs/rate-limiter.md);
> T42 CachePort decision done (ADR-0018: no Postgres backend, Redis
> deferred) — see
> [ADR-0018](../adr/0018-cache-no-postgres-backend-redis-deferred.md);
> **E03 now COMPLETE**: T43 Postgres IdempotencyStore adapter done
> (ADR-0019 added the `IdempotencyStore` port to the kernel, a blueprint
> prerequisite gap) — see
> [idempotency-key-store.md](../../packages/platform/docs/idempotency-key-store.md).
> Full epic-exit Engineering Health Report — see
> [E03-exit-report.md](../engineering/reviews/E03-exit-report.md).
> **Tenant Isolation Certification complete (2026-07-29)**: verdict
> CERTIFIED WITH RESIDUAL RISKS — see
> [tenant-isolation-certification.md](../security/tenant-isolation-certification.md),
> [security-scorecard.md](../security/security-scorecard.md), and
> [v0.1.0-alpha-readiness.md](../releases/v0.1.0-alpha-readiness.md). Found
> and fixed a real cross-tenant vulnerability (ADR-0020); added
> `GlobalRepository` + two architecture-fitness rules (ADR-0021); shipped
> the golden-path `examples/acme-crm-module` and a mandatory contributor
> safety guide). **E04-T01 contract-suite framework done** (2026-07-29):
> `@corestack/kernel/testing` — see
> [contract-suite-framework.md](../../packages/kernel/docs/contract-suite-framework.md).
> Cache/RateLimiter suites proven against both kernel's in-memory adapters
> and platform's real `PostgresRateLimiter`; zero added runtime
> dependencies (type-only vitest import). **All 7 founder-directed
> contract suites complete** (2026-07-29, T03–T09: Logger, EventBus,
> UnitOfWork, Encrypter, ProcessedEventStore, Health-check snapshots,
> IdempotencyStore) — two real bugs found and fixed along the way
> (ADR-0022 Logger runtime redaction/error serialization; a UUID-vs-
> readable-id bug caught by the ProcessedEventStore suite itself before
> shipping). E04-T02 (Testcontainers) remains an explicit external-
> environment blocker (no Docker), not attempted. Full record:
> [contract-governance.md](../testing/contract-governance.md),
> [adapter-certification-matrix.md](../testing/adapter-certification-matrix.md).
> **E04 Consolidation and Release-Hardening Mode complete (2026-07-29)**:
> [contract-coverage-audit.md](../testing/contract-coverage-audit.md) names,
> honestly, which suites have real mutation proof (Logger, ProcessedEventStore,
> IdempotencyStore's ADR-0020 case) vs. relocation-only (Cache, RateLimiter,
> Encrypter, UnitOfWork; EventBus partial) — see Test & coverage below. A
> repo-wide duplicate-test sweep found zero additional duplicates beyond
> what the T03–T09 conversions already removed.
> [snapshot-governance.md](../testing/snapshot-governance.md) codifies
> what may/must-never be snapshotted; both existing snapshot files audited
> as compliant. [performance/README.md](performance/) consolidates every
> baseline across both benchmark directories.
> [testcontainers-readiness.md](../testing/testcontainers-readiness.md)
> prepares E04-T02 with no runtime code, confirming its real scope is
> Postgres-only (no Redis/MinIO adapter exists to need one).
> [export-surface-audit.md](../releases/export-surface-audit.md) found and
> fixed two stale docs (kernel's package description, platform's README
> test counts) and named a real gap: only kernel's main entry has an
> export-surface snapshot — kernel's `./testing` subpath and all three of
> platform's conditions are ungated.
> [how-to-add-a-new-adapter.md](../contributing/how-to-add-a-new-adapter.md)
> is now the canonical 7-step contributor workflow. Full verdict:
> [e04-completion-report.md](../engineering/e04-completion-report.md) —
> **E04 complete except the external Docker blocker**.

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
| **P0**   | **0**                     | 5        | AUD-01…04 — see [remediation log](remediation-log.md); **+1** cross-tenant idempotency-key replay found and fixed during the Tenant Isolation Certification, never exposed to a real caller — see ADR-0020                                                                            |
| **P1**   | 1 _(scheduled by design)_ | 6        | AUD-07 is a _decision deferred to E06 design_ (auth limiter algorithm), not an unfixed defect                                                                                                                                                                                         |
| **P2**   | 9 _(6 mapped + 3 new)_    | 2        | AUD-12→E01-T02.4, AUD-13 done, AUD-14/15/16/18/19 tracked; **+3 new** from the outbox security review — checkpoint-table privilege separation, no per-handler timeout, no admin-action audit log (none externally exploitable — see [outbox-review.md](../security/outbox-review.md)) |

## Test & coverage

| Metric               | Value                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test files / tests   | **Unit/application lanes** (what `pnpm -r test` runs): 55 files / **536 tests**, re-measured 2026-07-30 — kernel 9/114 · lint fixtures 2/15 · architecture fitness 5/36 · platform 24/197 · example module 2/3 · **tenancy 13/171** (up from 8/94, +77 — 5 new test files totaling 75: `membership.test.ts` (37 tests: creation, owner invariants, promote/demote, invalid transitions, suspend/reactivate, remove, terminal remove, event emission/ordering, timestamps, immutability), `membership-id.test.ts`/`user-id.test.ts` (10 each), `membership-role.test.ts` (8), `membership-status.test.ts` (10); the remaining 2 were backfilled into the existing `index.test.ts` smoke test, one of which covers E05-T03's `createOrganization` export that task's own update missed). **Integration lanes** (separate command, unmeasured this run, unaffected by E05-T04): platform 14 files/97 tests, example module 1/4. Architecture-fitness stayed at 5/36 (E05-T04 added no new package/manifest surface — none of the new `membership*.ts`/`user-id.ts` files are repository-named) |
| Kernel coverage (v8) | **98.25% stmts · 97.98% branch · 91.48% funcs** (target ≥90% domain/application — met)                                                                        |
| Platform coverage    | Not yet measured — arrives with the coverage-gate task (E04-T11)                                                                                               |
| Coverage CI gate     | Not yet enforced (E04-T11) — tracked, honest                                                                                                                   |
| Unit-suite duration  | ~1 s repo-wide on cache hit (budget < 30 s)                                                                                                                    |
| Contract suites      | **8** — Cache, RateLimiter, Logger, EventBus, UnitOfWork, Encrypter, ProcessedEventStore, IdempotencyStore (Health-check is deliberately not a 9th — snapshot-tested instead, see matrix) |
| Certified adapters   | **13** of 13 existing adapters certified against their port's suite (every un-certified pairing is an adapter that doesn't exist yet — pino `Logger`, KMS `Encrypter` — correctly `pending`, not missing) — see [adapter-certification-matrix.md](../testing/adapter-certification-matrix.md) |
| Snapshot count       | **4 files / 10 snapshots** (2026-07-30, up from 3/8) — kernel's `api-surface.test.ts` (2: `.` and `./testing` export lists) + platform's `api-surface.test.ts` (3: `.`, `./postgres`, `./testing`) + platform's `health-readiness.test.ts` (3, payload shapes) + tenancy's new `api-surface.test.ts` (2: `.` and `./testing`; `./testing` snapshots `[]` — reserved, empty by design). All declared export conditions across kernel/platform/tenancy now gated — see [snapshot-governance.md](../testing/snapshot-governance.md) |
| Mutation-proven rules | **6 of 8 suites** (2026-07-30, up from 3) have on-record proof an assertion catches a real regression — Logger (ADR-0022), ProcessedEventStore (UUID bug), IdempotencyStore (historical ADR-0020 case), and, added by the E05 readiness gate, Cache (`NeverExpiringCache`), RateLimiter (`LexicographicRateLimiter`, reproducing E03-T41's real string-comparison bug), Encrypter (`FixedIvEncrypter`, reused-IV) — plus EventBus partial (1 of ~8 assertions) and the adapter-matrix fitness rule. `UnitOfWork` alone remains without mutation proof — a **deliberate deferral** (no plausible silent-mistake fixture exists for its assertions), not an oversight — see [contract-coverage-audit.md](../testing/contract-coverage-audit.md) |
| Performance baselines | **10** scripts total across two directories — 6 outbox subsystem + 4 E04 contract-suite adapters (RateLimiter, IdempotencyStore, ProcessedEventStore, UnitOfWork); none CI-gated, deferred to E04-T13 — see [performance/README.md](performance/) |

## Architecture & API

| Metric                      | Value                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| ADRs accepted               | **22** (0001–0022)                                                                                                                           |
| Architecture fitness tests  | **Live in CI**: layer boundaries (lint zones + fixtures), import cycles, cross-package boundaries, manifest/ADR compliance, kernel zero-deps, tenant-isolation rules (ADR-0021), contract-suite adapter matrix |
| Public API stability        | Kernel runtime surface snapshot-gated; full type-level report at E19-T14                                                                     |
| Kernel runtime dependencies | **0** (fitness-test-enforced)                                                                                                                |

## CI health

| Gate                  | Status                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Silent-success guards | ✅ `assert-turbo-tasks` on `test` (min 3) and `test:integration` (exact manifest — now non-trivially exercised: `@corestack/platform`, `@corestack/example-acme-crm-module`)  |
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

**Contract-suite adapters (E04):** first baseline captured 2026-07-29,
same local instance — four scripts covering the newly-certified
Postgres adapters (`PostgresRateLimiter.consume` 0.35ms mean,
`PostgresIdempotencyStore.begin` 0.34ms, `PostgresProcessedEventStore
.markProcessed` 0.30ms, `PostgresUnitOfWork.run` 0.74ms — the only one of
the four opening a full transaction). Also **not CI-gated, no
thresholds**, deferred to E04-T13. See
[contract-suite-adapter-benchmark-methodology.md](performance/contract-suite-adapter-benchmark-methodology.md)
and [docs/quality/performance/](performance/).

## Technical debt register (must be zero or justified)

| Item                                                                                                                                                   | Justification                                                                                              | Retires at           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------- |
| Type-level API report deferred                                                                                                                         | Runtime snapshot covers surface pre-1.0; api-extractor tooling costs unjustified before freeze             | E19-T14              |
| Coverage not CI-gated                                                                                                                                  | Gate lands with the test-infrastructure epic                                                               | E04-T11              |
| `/contracts` types-only rule enforced structurally, not type-level                                                                                     | Fitness test blocks runtime deep-imports; full types-only proof needs the first contracts subpath to exist | E01-T02.4 (E05 gate) |
| E03-T04 (migration authoring guide) never built                                                                                                        | Found at E03 exit review; low complexity (S/1d, DOC), not blocking any other epic                          | Unscheduled          |
| Platform's own tables (`outbox`, `rate_limits`, `idempotency_keys`) bootstrap via `ensure*Schema` application code, not T02's tracked migration runner | No incident yet (no shape changes since shipping); no drift detection if one ever changes                  | Unscheduled          |
| No export-surface snapshot for kernel's `./testing` subpath or any of platform's 3 conditions | Only kernel's main entry (`.`) is gated; an accidental rename/removal on the other 4 conditions has no automated signal — see [export-surface-audit.md](../releases/export-surface-audit.md) | Unscheduled — small, mechanical addition, natural first E04-follow-up task |
| 4 of 8 contract suites (Cache, RateLimiter, Encrypter, UnitOfWork) have no mutation proof; EventBus only partial | Relocated from already-passing tests; no observed pre-fix failure or broken fixture on record for these — see [contract-coverage-audit.md](../testing/contract-coverage-audit.md) | Unscheduled — closing this retroactively is real follow-up work under Section 12's proposed permanent policy |
| `manifest-rules.test.mjs` checks export-condition ordering only, not that declared `dist/` targets actually exist/resolve | Verified manually for this audit (all 5 conditions resolve); no regression today, but a future misconfigured subpath would only fail at consumer-import time | Unscheduled |
| `ModuleConfigSpec<T>.schema`'s `ZodType<T>` type can't express an optional or coerced config field under `exactOptionalPropertyTypes` (confirmed empirically building tenancy's config spec, E05-T01) | Worked around module-locally (required-string fields + an `EnvSource`-level defaulting wrapper); relaxing the platform type is a deliberate future decision with cross-module blast radius, not a fix to smuggle into a module task — see [e05-readiness-friction-log.md](../engineering/e05-readiness-friction-log.md) | Unscheduled |

## Documentation coverage

All 21 ADRs current · design docs (architecture/database/api) versioned ·
5 guide structures approved · overview.md reconciled (AUD-11) ·
docs drift-check joins every epic-exit checklist (AUD-19). **E03 exit
review complete (2026-07-29)** — see
[E03-exit-report.md](../engineering/reviews/E03-exit-report.md) and the
epic's two lessons-learned files
([outbox](../engineering/lessons/e03-outbox-epic.md),
[tenant isolation & adapters](../engineering/lessons/e03-tenant-isolation-and-adapters.md));
this pass caught and fixed two stale docs (`outbox-architecture.md`'s
T40 status, a stale code comment about `Sql`/`TransactionSql` typing) and
one never-built task (E03-T04, now tracked debt above). Outbox
subsystem consolidated (2026-07-28): end-to-end architecture map with
sequence diagram, operational runbook, security review, observability
contract, and health/readiness contract — see
[E03-outbox-milestone-report.md](../engineering/reviews/E03-outbox-milestone-report.md)
for the full index. Two stale cross-references caught and fixed in the
same pass (E03-entry-review.md's runbook path; several component specs'
Testcontainers-only test framing, once local Postgres 18 became a second
mode). PostgreSQL 18 compatibility verified empirically — see
[postgres-18-compatibility.md](../platform/postgres-18-compatibility.md).
**E04 Consolidation and Release-Hardening Mode complete (2026-07-29)**: 6
new docs — contract coverage audit, snapshot governance, consolidated
performance README, Testcontainers readiness, export-surface audit, and
the contributor "how to add a new adapter" guide (full index in the header
note above). Two stale docs found and fixed in the same pass (kernel's
`package.json` description omitted 2 shipped ports; platform's README
scorecard cited pre-E04 test counts).

## Infrastructure maturity

**79/100** as of the E03 epic-exit re-score (2026-07-29), covering the
whole epic — RLS/org-scoping, composition root, health/readiness,
graceful shutdown, and all four Postgres adapters — not just the outbox
subsystem the prior 83/100 scored. Scored per-dimension (contract
completeness, test rigor, operational readiness, security posture,
performance visibility, documentation coherence) in
[E03-exit-report.md §5](../engineering/reviews/E03-exit-report.md). The
outbox-only 83/100 (2026-07-28,
[E03-outbox-milestone-report.md §6](../engineering/reviews/E03-outbox-milestone-report.md))
remains historically accurate for that narrower scope; the drop isn't a
regression, it's a wider, less-weathered surface being scored honestly for
the first time. Held back mainly by operational tooling maturity (runbook
procedures like replay are manual SQL, not yet a built API) and
performance visibility (a baseline exists only for outbox hot paths; T30/T31/T33/T40/T41/T43's
Postgres operations are proven correct under concurrency but unbenchmarked).
