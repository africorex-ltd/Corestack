# Engineering Blueprint — M0: Foundation

Epics E01–E04. Field semantics, category standards (testing/docs/DoD), and
scales: see [00-OVERVIEW.md](00-OVERVIEW.md). Everything here gates all module
work (Sequencing Rule 1).

---

## E01 — Foundation & Governance (M0, 22 tasks, ~30d)

**Goal:** a repository whose pipeline, security posture, and contribution
infrastructure meet the bar the vision claims — before the first module lands.

### F1.1 Repository & Tooling Baseline

| ID      | Task — Description                                                                                                                     | Cat | Pri | Deps | Cx/Est  | Acceptance criteria & subtasks                                                                                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01-T01 | Workspace hardening — finalize pnpm/turbo config: `tooling/` for shared tsconfig+prettier presets, single-version policy for TS/Vitest | INF | P0  | —    | S/1d    | Presets consumed from `tooling/*` by kernel; duplicate-version check script fails CI on drift                                                                     |
| E01-T02 | ESLint flat config + import-boundary enforcement — per-layer import rules (domain→kernel only, etc.) as lint errors                    | INF | P0  | T01  | M/2d    | Violating import in a fixture fails lint; rules documented in tooling README. Sub: .1 base config; .2 boundary plugin rules; .3 no-console/no-sensitive-log rules |
| E01-T03 | Commit/PR conventions — commitlint (Conventional Commits), PR template with Task-ID field, CODEOWNERS                                  | INF | P1  | —    | XS/0.5d | Non-conforming commit rejected in CI; template live                                                                                                               |
| E01-T04 | `.github` issue templates — bug (repro required), feature (RFC pointer), security (redirect to private reporting)                      | INF | P1  | —    | XS/0.5d | Three templates render; security template links SECURITY.md                                                                                                       |
| E01-T05 | Renovate configuration — grouped weekly updates, pinned GitHub Actions by SHA, lockfile maintenance                                    | INF | P1  | T06  | S/1d    | First Renovate PR opened and green; actions pinned                                                                                                                |

### F1.2 CI Pipeline

| ID      | Task — Description                                                                                                         | Cat | Pri | Deps | Cx/Est  | Acceptance criteria & subtasks                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | --- | --- | ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| E01-T06 | Core PR workflow — lint → typecheck → unit → build across the workspace with turbo caching                                 | INF | P0  | T01  | M/2d    | PR run < 5 min on cache hit; required check on `main`. Sub: .1 workflow; .2 turbo remote cache wiring; .3 required-checks branch protection |
| E01-T07 | Integration test lane — service containers (Postgres 16) with health-gated startup; separate `test:integration` turbo task | INF | P0  | T06  | M/2d    | Sample Testcontainers spec passes in CI; lane skippable locally                                                                             |
| E01-T08 | Merge queue — enable queue on `main`; document flow in CONTRIBUTING                                                        | INF | P2  | T06  | XS/0.5d | Queue active; docs updated                                                                                                                  |
| E01-T09 | CI observability — per-job timing summary + flaky-test detection (retry-once with flake report artifact)                   | INF | P2  | T06  | S/1d    | Flake report artifact produced; timing visible in summary                                                                                   |

### F1.3 Security Lane

| ID      | Task — Description                                                                                                             | Cat | Pri | Deps | Cx/Est  | Acceptance criteria & subtasks                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | --- | --- | ---- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| E01-T10 | CodeQL + dependency audit workflows — PR + nightly schedule                                                                    | SEC | P0  | T06  | S/1d    | Findings surface as PR annotations; nightly run green                                                                    |
| E01-T11 | Secret scanning + push protection — org-level enable, custom patterns for `csk_` key format                                    | SEC | P0  | —    | XS/0.5d | Test push with dummy pattern blocked                                                                                     |
| E01-T12 | License compliance check — MIT-compatible allowlist enforced over the dependency tree                                          | INF | P1  | T06  | S/1d    | Non-allowlisted license fails CI with actionable message                                                                 |
| E01-T13 | Security response runbook — triage SLAs, severity matrix, advisory workflow, backport policy (implements SECURITY.md promises) | DOC | P1  | —    | S/1d    | Runbook in `docs/runbooks/security-response.md`; dry-run tabletop performed. Sub: .1 runbook; .2 tabletop exercise notes |

### F1.4 Release Engineering

| ID      | Task — Description                                                                                            | Cat | Pri | Deps | Cx/Est | Acceptance criteria & subtasks                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------- | --- | --- | ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01-T14 | Changesets wiring — version PR automation, per-package changelogs, 0.x semver policy encoded                  | REL | P0  | T06  | M/2d   | Version PR generated from a sample changeset; changelog rendered                                                                                                |
| E01-T15 | npm publish pipeline with provenance — CI-only publish, Sigstore attestation, granular tokens, 2FA org policy | REL | P0  | T14  | M/2d   | Dry-run publish of kernel with verifiable provenance; no human publish path remains. Sub: .1 pipeline; .2 org token/2FA config; .3 provenance verification step |
| E01-T16 | Install-from-tarball smoke test — pack each publishable package, install in a clean fixture, import & run     | REL | P1  | T15  | S/1d   | ESM import + type resolution verified for kernel in Node LTS matrix (20/22)                                                                                     |
| E01-T17 | Compatibility table automation — generate per-release package compatibility matrix into docs                  | REL | P2  | T14  | S/1d   | Table generated in release artifacts                                                                                                                            |

### F1.5 Governance Docs

| ID      | Task — Description                                                                     | Cat | Pri | Deps | Cx/Est  | Acceptance criteria & subtasks                                   |
| ------- | -------------------------------------------------------------------------------------- | --- | --- | ---- | ------- | ---------------------------------------------------------------- |
| E01-T18 | ADR batch 0007–0015 — codify the nine decisions from Architecture §48                  | DOC | P0  | —    | M/2d    | Nine ADRs merged, indexed, cross-linked to Architecture sections |
| E01-T19 | RFC process — template + lifecycle (draft→FCP→accepted) in `docs/rfc/`                 | DOC | P1  | —    | S/1d    | Template + process doc merged; first RFC number reserved         |
| E01-T20 | Code of Conduct + enforcement ladder                                                   | DOC | P1  | —    | XS/0.5d | Contributor Covenant adapted; contacts defined                   |
| E01-T21 | DCO enforcement — sign-off check on PRs, CONTRIBUTING updated (no CLA, per vision §16) | INF | P1  | T03  | XS/0.5d | Unsigned commit fails check                                      |
| E01-T22 | Public roadmap document — milestone view auto-derived from this blueprint              | DOC | P2  | —    | S/1d    | `docs/ROADMAP.md` generated/linked from overview §6              |

---

## E02 — Kernel `@corestack/kernel` (M0, 14 tasks, ~20d)

**Goal:** complete the kernel's contract surface (Result/errors/clock/id exist)
so modules never need ad-hoc infrastructure types. Kernel rule: zero runtime
deps, no Node builtins, no business meaning.

### F2.1 Eventing Contracts

| ID      | Task — Description                                                                                                                                                  | Cat | Pri | Deps | Cx/Est | Acceptance criteria & subtasks                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E02-T01 | Domain event envelope type — id, name, version, occurredAt, orgId?, actor, correlation/causation, payload; JSON-serializability constraint                          | DOM | P0  | —    | S/1d   | Envelope type + factory with `Clock`/`IdGenerator`; property test: round-trips JSON                                                                     |
| E02-T02 | `EventBus` port — publish (batch), subscribe with consumer name + accepted versions; delivery semantics documented (sync in-proc default; at-least-once via outbox) | APP | P0  | T01  | M/2d   | Port + in-memory reference implementation; ordering + error-propagation semantics specified in TSDoc. Sub: .1 port; .2 in-memory impl; .3 semantics doc |
| E02-T03 | Idempotent-consumer helper contract — dedupe interface consumed by outbox relay (DB `platform.processed_events`)                                                    | APP | P1  | T02  | S/1d   | Interface + in-memory impl + contract-suite skeleton                                                                                                    |

### F2.2 Ambient Ports

| ID      | Task — Description                                                                                            | Cat | Pri | Deps | Cx/Est | Acceptance criteria & subtasks                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------- | --- | --- | ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| E02-T04 | `Logger` port — leveled, structured, child-context binding; no-op default                                     | APP | P0  | —    | S/1d   | Port + noop + test-capture implementations; redaction hook point defined                                                                           |
| E02-T05 | `Context` type — actor, orgId?, correlationId, causationId, locale; propagation rules in TSDoc                | APP | P0  | —    | S/1d   | Type + factory + child-context derivation; used by E02-T02 envelope factory                                                                        |
| E02-T06 | UUIDv7 `IdGenerator` — replace v4 reference impl per DB rule 2 (port unchanged)                               | ADP | P0  | —    | S/1d   | v7 monotonicity within ms verified; kernel README updated; changeset (breaking: generated id format)                                               |
| E02-T07 | `CachePort` — get/set/delete with TTL + key-version invalidation helper (Architecture §12)                    | APP | P1  | —    | S/1d   | Port + in-memory LRU reference; version-stamped key helper with tests                                                                              |
| E02-T08 | `RateLimiter` port — consume(bucket, cost) → allowed/retryAfter; fixed-window semantics doc                   | APP | P0  | —    | S/1d   | Port + in-memory impl; contract-suite skeleton                                                                                                     |
| E02-T09 | `Encrypter` port — encrypt/decrypt with key-id (AES-256-GCM semantics), for TOTP/webhook secrets (DB rule 10) | APP | P0  | —    | M/2d   | Port + WebCrypto reference impl + key-rotation semantics (decrypt old key-id, encrypt current). Sub: .1 port; .2 WebCrypto impl; .3 rotation tests |
| E02-T10 | `UnitOfWork` port — transaction scoping contract for use cases (Architecture §3)                              | APP | P0  | —    | M/2d   | Port + in-memory impl; semantics: one UoW per use case, outbox write inside                                                                        |

### F2.3 Error & Result Completion

| ID      | Task — Description                                                                                                                                 | Cat | Pri | Deps         | Cx/Est  | Acceptance criteria & subtasks                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------- | --------------------------------------------------------------- |
| E02-T11 | Error taxonomy completion — add `RateLimitedError`, `PreconditionFailedError` (step-up), `PayloadTooLargeError`; freeze `core/*` code registry doc | DOM | P0  | —            | S/1d    | Codes stable-documented; mapping table entry for each (API §21) |
| E02-T12 | Result utilities completion — `all` (combine), `fromPromise` (throw→Err boundary helper), async variants of map/andThen                            | DOM | P1  | —            | S/1d    | Property tests for combinator laws; TSDoc examples compile      |
| E02-T13 | Kernel API reference pass — every export TSDoc'd with example; API-extractor report snapshot committed                                             | DOC | P1  | T01–T12      | S/1d    | api-report diff gate active in CI                               |
| E02-T14 | Kernel 0.1 release — first real publish through E01-T15 pipeline                                                                                   | REL | P0  | E01-T15, T13 | XS/0.5d | On npm with provenance; tarball smoke green                     |

---

## E03 — Platform Infrastructure (M0, 24 tasks, ~42d)

**Goal:** the `platform` schema machinery every module relies on: migrations,
outbox, composition, config — built and proven in a test harness before any
module exists to depend on it. Package: `@corestack/platform` (internal name;
ships as part of composition tooling).

### F3.1 Migration Engine

| ID      | Task — Description                                                                                                        | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E03-T01 | Migration format & loader — plain-SQL files with header metadata (lock-impact note), per-module ordered sets              | APP | P0  | E02-T14 | M/2d   | Loader validates ordering + checksum; malformed header rejected                                                                                                          |
| E03-T02 | `platform.module_migrations` runner — apply with per-module version tracking, checksum drift detection (DB §3, §18)       | ADP | P0  | T01     | L/3d   | Contract: applies in order, records checksum, refuses drifted history with actionable error. Sub: .1 runner; .2 drift detection; .3 advisory-lock for concurrent runners |
| E03-T03 | Partition maintenance job spec — create-ahead + retention-drop for monthly-partitioned tables; pg_partman-optional design | ADP | P1  | T02     | M/2d   | Creates next 2 periods; drop honors checkpoint safety (outbox)                                                                                                           |
| E03-T04 | Migration authoring guide — expand-and-contract patterns, CONCURRENTLY rules, backfill-as-separate-step (DB §18)          | DOC | P1  | T02     | S/1d   | Guide with 3 worked examples; linked from CONTRIBUTING                                                                                                                   |

### F3.2 Transactional Outbox

| ID      | Task — Description                                                                                                    | Cat | Pri | Deps                  | Cx/Est | Acceptance criteria & subtasks                                                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------- | --- | --- | --------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E03-T10 | Outbox schema migration — `platform.outbox` partitioned + checkpoints + processed_events (DB §3)                      | ADP | P0  | T02                   | M/2d   | Migration applies; append-only privileges verified by test                                                                                                                                                |
| E03-T11 | Outbox writer — EventBus-backed writes inside UnitOfWork transaction                                                  | ADP | P0  | T10, E02-T02, E02-T10 | M/2d   | Events written atomically with state change; rollback discards events (tested)                                                                                                                            |
| E03-T12 | Outbox relay — polling dispatcher with per-consumer checkpoints, batch by `(occurred_at,id)` cursor, at-least-once    | ADP | P0  | T11                   | L/4d   | Contract: no event skipped across restart; redelivery on consumer failure; checkpoint advances only after success. Sub: .1 poller; .2 checkpointing; .3 graceful shutdown drain; .4 relay lag metric hook |
| E03-T13 | Crash-consistency test suite — kill-mid-transaction scenarios proving no lost/duplicated effects (Architecture §44.5) | TST | P0  | T12                   | L/3d   | Suite in contract kit; runs in CI integration lane; documented scenarios: crash before commit, after commit pre-dispatch, mid-dispatch                                                                    |
| E03-T14 | Idempotent consumer helper (Postgres) — processed_events dedupe implementing E02-T03                                  | ADP | P0  | T12                   | S/1d   | Contract suite green; replay of same event id is a no-op                                                                                                                                                  |

### F3.3 Composition Root

| ID      | Task — Description                                                                                                                             | Cat | Pri | Deps     | Cx/Est | Acceptance criteria & subtasks                                                                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E03-T20 | Module lifecycle contract types — `createXModule(deps, config)` → useCases/eventHandlers/migrations/health (Architecture §8)                   | APP | P0  | E02-T14  | M/2d   | Types + conformance checker; fixture module passes                                                                                                                                                 |
| E03-T21 | `createCoreStack()` composition helper — wires modules, adapters, bus, UoW; explicit, no reflection                                            | APP | P0  | T20      | L/3d   | Fixture composition boots with 2 fake modules; wiring errors are compile-time where possible, else boot-fail with precise message. Sub: .1 API design note; .2 implementation; .3 boot diagnostics |
| E03-T22 | Config validation framework — per-module Zod schemas, env mapping, secret-ref indirection, fail-fast aggregate report                          | APP | P0  | T20      | M/2d   | All config errors reported at once (not first-fail); secrets never in error output                                                                                                                 |
| E03-T23 | Health/readiness framework — liveness + readiness (DB reachable, migrations current, relay running) composed across modules (Architecture §31) | APP | P1  | T21, T12 | M/2d   | Standard shape; readiness flips on induced relay stop                                                                                                                                              |
| E03-T24 | Graceful shutdown orchestration — SIGTERM: stop intake → drain relay/jobs → close pools; ordered, bounded by timeout                           | APP | P1  | T21      | M/2d   | Shutdown test proves drain order and bound                                                                                                                                                         |

### F3.4 Tenant Isolation Infrastructure

| ID      | Task — Description                                                                                                                        | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                                                                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E03-T30 | RLS harness — per-transaction `app.current_org` setting, application vs platform roles, policy templates (DB §15)                         | ADP | P0  | T02     | L/3d   | Template policies apply to a fixture table; wrong-org read returns empty under RLS with correct port behavior above. Sub: .1 role setup migration; .2 policy template; .3 tx-scoped setter in adapter base |
| E03-T31 | Repository base utilities — org-scoped query helpers enforcing org-id presence at type level                                              | ADP | P0  | T30     | M/2d   | Type error (not runtime) when org-scoped helper called without org; used by fixture repo                                                                                                                   |
| E03-T32 | Context resolution middleware spec — session/API-key → `Context` with resolved org membership; never client-asserted (Architecture §20.2) | APP | P0  | E02-T05 | M/2d   | Spec + reference implementation hooks for E14; forged-org-header test fails closed                                                                                                                         |
| E03-T33 | Purge protocol framework — `organization.purge_requested` fan-out registration; per-module purge handler contract + completion tracking   | APP | P1  | T12     | M/2d   | Fixture module's purge handler invoked exactly once, idempotent on replay                                                                                                                                  |

### F3.5 Shared Postgres Adapter Base

| ID      | Task — Description                                                                                                                | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | -------------------------------------------------------------------------------------------------- |
| E03-T40 | Drizzle base setup — connection management, tx-scoped UnitOfWork implementation, no-await-across-connection discipline (DB §20.2) | ADP | P0  | E02-T10      | M/2d   | UoW contract suite green vs real Postgres                                                          |
| E03-T41 | Postgres `RateLimiter` adapter — fixed-window on `platform.rate_limits` (DB §3)                                                   | ADP | P1  | E02-T08, T02 | S/1d   | Contract suite green; window pruning covered                                                       |
| E03-T42 | Postgres `CachePort` decision note + in-memory/Redis adapters — LRU (node) reference; Redis adapter with version-key invalidation | ADP | P2  | E02-T07      | M/2d   | Both pass cache contract suite; Redis via Testcontainers                                           |
| E03-T43 | Idempotency-key store adapter — `platform.idempotency_keys` semantics (DB §3): in-progress lock, replay, body-hash conflict       | ADP | P1  | T02          | M/2d   | Contract: concurrent same-key second caller blocks/conflicts correctly (tested with 2 connections) |

---

## E04 — Testing Infrastructure (M0, 16 tasks, ~26d)

**Goal:** the contract-test kit and fakes that make "swap anything" verifiable
(Architecture §44.3) — built _before_ modules so every adapter is born tested.
Ships as `@corestack/testing` + per-module `/testing` subpaths.

### F4.1 Contract Kit Core

| ID      | Task — Description                                                                                                    | Cat | Pri | Deps         | Cx/Est  | Acceptance criteria & subtasks                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E04-T01 | Contract-suite framework — declare abstract suite once, run against any implementation with setup/teardown hooks      | TST | P0  | E02-T14      | M/2d    | Kernel's in-memory impls pass their own suites via the framework                                                                                                                |
| E04-T02 | Testcontainers harness — Postgres/Redis/MinIO lifecycle helpers, per-suite isolated schemas, CI-cache-friendly images | TST | P0  | T01, E01-T07 | M/2d    | Parallel suites don't collide; cold-start < 30 s in CI. Sub: .1 pg helper; .2 redis/minio; .3 parallelism isolation                                                             |
| E04-T03 | Port contract suites for kernel ports — EventBus, Cache, RateLimiter, Encrypter, UnitOfWork, IdempotencyStore         | TST | P0  | T01          | L/4d    | Each suite: semantics from the port's TSDoc encoded as tests; in-memory + Postgres adapters both green. Sub: .1 bus; .2 cache; .3 limiter; .4 encrypter; .5 UoW; .6 idempotency |
| E04-T04 | Clock/Id determinism helpers — FixedClock/SequentialId wiring sugar for application tests                             | TST | P2  | —            | XS/0.5d | Used by fixture module tests                                                                                                                                                    |

### F4.2 Isolation & Authorization Suites

| ID      | Task — Description                                                                                                                                     | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | --- | ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| E04-T05 | Cross-tenant isolation suite framework — declarative: register use case + factory, suite attempts cross-org access for every case (Architecture §44.5) | SEC | P0  | T02, E03-T31 | L/3d   | Fixture module: injected cross-org case fails the suite; passing requires not-found/forbidden. **CI-unskippable wiring (E01-T06 required check)** |
| E04-T06 | Authorization matrix suite framework — every protected use case × every baseline role, expected allow/deny declared                                    | SEC | P0  | T05          | M/2d   | Matrix gaps (undeclared case) fail the suite — coverage by construction                                                                           |
| E04-T07 | RLS backstop verification suite — same isolation scenarios run with deliberately-broken port scoping to prove RLS catches them (DB §15)                | SEC | P1  | T05, E03-T30 | M/2d   | Suite proves the seatbelt independently of the steering                                                                                           |

### F4.3 Fakes & Fixtures

| ID      | Task — Description                                                                                                           | Cat | Pri | Deps | Cx/Est | Acceptance criteria & subtasks                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- | --- | --- | ---- | ------ | ----------------------------------------------------------------------------------------------------- |
| E04-T08 | Fake adapter kit — in-memory repositories base, capturing MailSender/PaymentGateway/FileStorage fakes with assertion helpers | TST | P0  | T01  | M/2d   | Fakes behave per contract suites (fakes are contract-tested too — that's what makes them trustworthy) |
| E04-T09 | Fixture factory framework — typed builders for users/orgs/memberships with sensible defaults, per-module extension           | TST | P1  | —    | M/2d   | Fixture module uses builders; overrides typed                                                         |
| E04-T10 | Seed data profiles — `dev` (rich demo data) and `test` (minimal) profiles consumed by CLI `dev seed` later                   | TST | P2  | T09  | S/1d   | Profiles defined; consumed by fixture harness                                                         |

### F4.4 Quality Gates

| ID      | Task — Description                                                                                             | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                                              |
| ------- | -------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------ | --------------------------------------------------------------------------- |
| E04-T11 | Coverage gates — ≥ 90% domain/application enforced per-package; adapters exempt-listed (integration-covered)   | INF | P0  | E01-T06 | S/1d   | Under-threshold package fails CI with per-file report                       |
| E04-T12 | Test-speed budget — unit+application repo-wide < 30 s gate (Architecture §44)                                  | INF | P1  | T11     | S/1d   | Budget check in CI; current timing published in summary                     |
| E04-T13 | Microbenchmark harness — hot-path benchmarks with regression thresholds (Architecture §43)                     | TST | P1  | —       | M/2d   | Fixture benchmark (session-lookup shape) runs in CI, fails on 2× regression |
| E04-T14 | OpenAPI snapshot testing harness — spec snapshot diff gate for API-category tasks                              | TST | P1  | —       | S/1d   | Snapshot update requires explicit flag; diff in PR                          |
| E04-T15 | Fuzz harness (targeted) — parser fuzzing rig for cursor decoding + webhook signature inputs (Architecture §44) | SEC | P2  | —       | M/2d   | Rig + 2 seed corpora; wired to nightly lane                                 |
| E04-T16 | Contract kit docs — "testing your adapter" + "testing your app against CoreStack" guides                       | DOC | P1  | T01–T08 | M/2d   | Both guides build; adapter guide walks the full suite lifecycle             |
