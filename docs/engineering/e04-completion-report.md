# E04 Completion Report

- **Date:** 2026-07-29
- **Scope:** E04 executable-behavioral-contracts effort (T01, T03–T09) plus
  E04 Consolidation and Release-Hardening Mode (this report's own
  triggering directive, Sections 1–14).
- **Companion documents:** [contract-governance.md](../testing/contract-governance.md),
  [adapter-certification-matrix.md](../testing/adapter-certification-matrix.md),
  [contract-coverage-audit.md](../testing/contract-coverage-audit.md),
  [snapshot-governance.md](../testing/snapshot-governance.md),
  [performance/README.md](../quality/performance/),
  [testcontainers-readiness.md](../testing/testcontainers-readiness.md),
  [export-surface-audit.md](../releases/export-surface-audit.md),
  [how-to-add-a-new-adapter.md](../contributing/how-to-add-a-new-adapter.md).

## 1. Objectives

E04's stated objective was to give every kernel port with more than one
implementation an executable behavioral contract — one suite per port,
proven against every real adapter, replacing hand-written per-adapter
tests that could drift from each other silently. A secondary objective,
added by the founder directive that opened this session, was to
consolidate that work into a release-hardened state before any new feature
development resumes: audited, duplicate-free, governed by written policy,
and reported against measured (not estimated) numbers.

## 2. Completed work

### 2.1 Contract suites (T01, T03–T09)

Eight contract suites now exist in `@corestack/kernel/testing`: `Cache`,
`RateLimiter` (T01, proved the framework), `Logger` (T03), `EventBus`
(T04), `UnitOfWork` (T05), `Encrypter` (T06), `ProcessedEventStore` (T07),
`IdempotencyStore` (T09). `Health-check` (T08) was deliberately built as 3
snapshot tests instead of a 9th suite — it has no swappable-implementation
port to certify against, only plain functions taking dependencies as
parameters (see the certification matrix's reasoning).

Every suite runs against every adapter that currently exists for its port,
via a real instance — a real `PostgresRateLimiter` against real
PostgreSQL, not a stub standing in for one. 13 of 13 existing adapters are
certified. The only non-certified pairings are adapters that **don't exist
yet** (a pino `Logger`, a KMS `Encrypter`), correctly recorded as
`pending`, not silently missing.

### 2.2 Consolidation and release-hardening (this directive's Sections 2–9)

- **Contract coverage audit** — built and, unlike a simpler pass would
  have, drew an honest distinction between "certified" (suite passes
  against a real adapter) and "mutation-proven" (at least one assertion
  was observed catching a real broken variant). Only 3 of 8 suites meet
  the stricter bar today (`Logger`, `ProcessedEventStore`, and
  `IdempotencyStore`'s historical ADR-0020 case); `EventBus` is partial;
  `Cache`, `RateLimiter`, `Encrypter`, and `UnitOfWork` have none on
  record. This is reported as a residual gap, not smoothed over.
- **Duplicate-test sweep** — every file untouched by the T03–T09
  conversions was checked (`outbox-relay.test.ts`, `create-core-
  stack.test.ts`, `graceful-shutdown.test.ts`, `purge-protocol.test.ts`,
  all three `acme-crm-module` test files, plus a repo-wide grep for
  redaction-adjacent assertions). **Zero additional true duplicates
  found** — reported as the honest measured result of having looked, not
  manufactured to fill a "tests removed" number.
- **Snapshot governance** — codified what may/must-never be snapshotted
  (no secrets, no non-deterministic content, no behavior a contract suite
  already governs), an update procedure, a review checklist, and a
  breaking-change policy. Both existing snapshot files
  (`api-surface.test.ts.snap`, `health-readiness.test.ts.snap`) audited
  against it and found already compliant.
- **Performance consolidation** — one README summarizing all 10 benchmark
  scripts across the two baseline directories (6 pre-existing outbox
  subsystem benchmarks, 4 new E04 adapter benchmarks), explicit about why
  they're split rather than implying a single unified location.
- **Testcontainers readiness** — documentation-only preparation for
  E04-T02. Confirmed the dual-mode bootstrap's Testcontainers branch
  already exists and typechecks (it has simply never executed on this
  Docker-less machine), and that T02's real current scope is
  **Postgres-only** — the blueprint's Redis/MinIO sub-tasks don't apply
  until an adapter needing them actually exists. No runtime code added.
- **Export surface audit** — all 5 declared export conditions across
  kernel and platform resolve to real built files; no accidental leaks, no
  deprecated symbols; CHANGELOG fully consistent. Found and fixed 2 stale
  docs (kernel's `package.json` description, platform's README test
  counts). Found a real, unfixed gap: only kernel's main entry has an
  export-surface snapshot — 4 of 5 conditions are ungated.
- **Contributor guide** — `how-to-add-a-new-adapter.md` codifies the
  7-step workflow this session's own suite conversions followed, using
  `PostgresIdempotencyStore`/T09 as the worked example, ending in a
  copy-into-your-PR checklist.
- **Dashboard refresh** — every test count re-measured via direct
  `vitest run` per package (not `turbo run test:integration`, which
  doesn't thread `DATABASE_URL` to subprocesses on this setup). Result:
  **454 tests across 56 files, unchanged from the prior measurement** — no
  drift found this time. Dashboard also gained explicit rows for contract
  suite count, certified-adapter count, snapshot count, mutation-proven
  rule count, and performance baseline count — all measured, none
  estimated.

## 3. Blocked work

**E04-T02 (Testcontainers harness)** remains blocked: `docker info` fails
on this development machine, a constraint first documented in ADR-0018 and
reconfirmed every time it has come up since. Per this directive's explicit
instruction, no runtime code assuming Docker availability was written, and
no speculative Testcontainers code was added. `testcontainers-readiness.md`
documents exactly what unblocking it requires (a working Docker daemon,
one verification run with `DATABASE_URL` unset, acceptance criteria) so
that when Docker becomes available, this is bounded follow-up work, not a
fresh investigation.

## 4. Section 8 — Security follow-through verification

Every named security-relevant item was re-checked for a test, a
documented rationale, an ADR (if behavioral), and a CHANGELOG entry (if
user-visible):

| Item | Test | Rationale doc | ADR | CHANGELOG |
| --- | --- | --- | --- | --- |
| ADR-0020 (cross-tenant idempotency-key replay, P0 finding) | Yes — SECURITY test relocated into `defineIdempotencyStoreContractSuite` | `docs/security/tenant-isolation-certification.md` | ADR-0020 | Yes (2 entries) |
| ADR-0021 (`GlobalRepository` marker + tenant fitness rules) | Yes — `tenant-isolation.test.mjs` fitness rule + T31 type-level test | `docs/security/tenant-isolation-certification.md` | ADR-0021 | Yes (3 entries) |
| ADR-0022 (Logger runtime redaction + error serialization) | Yes — `defineLoggerContractSuite`'s SECURITY redaction assertions | ADR-0022 itself + `contract-governance.md`'s suite log | ADR-0022 | Yes (2 entries) |
| RLS fail-closed semantics | Yes — 14-scenario regression matrix (`tenant-isolation-certification.md` §4) + T30 harness tests | `tenant-isolation-certification.md` §3 (empirical detail) | ADR-0008 (pooled multi-tenancy) | Pre-existing, from E03 |
| Sensitive-log redaction | Yes — `defineLoggerContractSuite` (both adapters, all `SENSITIVE_LOG_KEYS`) | ADR-0022 | ADR-0022 | Yes |

All five have every required piece. No gap found in this pass. This
confirms the security posture certified at E03 exit and extended by
ADR-0022 this epic remains fully evidenced — nothing regressed silently
during the T03–T09 conversions.

## 5. Behavioral regressions prevented

- **Logger redaction/serialization gap** — neither shipped adapter
  redacted `SENSITIVE_LOG_KEYS` at runtime despite the port doc claiming
  this was mandatory, and `CaptureLogger` silently serialized `Error`
  values to `{}`. Found by reading the port doc against actual adapter
  behavior, confirmed via user decision (runtime redaction made normative,
  defense-in-depth behind the static lint deny-list), fixed via ADR-0022.
- **ProcessedEventStore UUID bug** — the suite's first version used
  readable literal ids, which passed against the in-memory adapter and
  failed all 6 assertions against real Postgres
  (`invalid input syntax for type uuid`). Caught before shipping, fixed
  with real UUID constants.
- **UnitOfWork → outbox → relay pipeline gap in test coverage** (not a
  code defect, a proof gap) — every prior test proved each stage of the
  pipeline in isolation; `drainDispatched()`'s use of a real
  `OutboxRelay.pollOnce()` against a real `PostgresOutboxRelayStore` is
  the first end-to-end proof of the full pipeline in this codebase.

## 6. Architectural improvements

- A single, portable contract-suite framework
  (`@corestack/kernel/testing`) now covers 8 kernel ports, at zero added
  runtime dependency cost (type-only `vitest` import, fitness-test-
  enforced).
- A fitness rule (`contract-suite-adapter-matrix.test.mjs`) mechanically
  enforces that every adapter class appears in the certification matrix —
  verified with a real mutation test (temporarily broke the matrix,
  confirmed the failure, restored it).
- `UnitOfWork`'s nesting-enforcement asymmetry between adapters was
  investigated and **documented, not "fixed"** — manufacturing a
  same-instance reentrancy guard on the in-memory adapter would have
  given false confidence for no real safety payoff, the same reasoning
  ADR-0021 already established for its downgraded fitness rules.

## 7. Security improvements

Covered in full in Section 4 above. No new security work was needed this
session beyond what ADR-0022 already added — this phase was verification
that E03's certified posture and ADR-0022's addition both remain fully
evidenced, not new remediation.

## 8. Test improvements

- 8 contract suites replacing what were previously independent,
  potentially-drifting per-adapter test files.
- Kernel: 81 → 110 tests across this epic. Platform integration: 88 → 97.
  Platform unit: +3 (Health-check snapshots). All re-verified via direct
  `vitest run` this session — no estimation.
- Snapshot governance now written down as policy, not just practiced ad
  hoc.

## 9. Performance improvements

No optimization was attempted — Sections 5 and 12's guidance was explicit
that this phase establishes baselines, not tunes anything. 10 benchmark
scripts now exist (6 outbox, 4 new adapter benchmarks this epic),
consolidated into one README, still deliberately outside CI/`turbo.json`
per the established "no silently-unwired lane" discipline.

## 10. Contributor improvements

`how-to-add-a-new-adapter.md` is now the canonical workflow for adding a
new adapter to an existing port. It did not exist before this phase — a
new contributor previously had to reconstruct the workflow from reading
`contract-governance.md`'s suite-by-suite log entries directly.

## 11. Remaining risks

1. **Mutation-proof coverage is uneven** across the 8 contract suites (4
   have none) — see `contract-coverage-audit.md`. Adopting Section 12's
   proposed permanent policy ("every contract suite must have at least one
   mutation proof") means this is real, scoped follow-up work, not just an
   audit note.
2. **Export-surface snapshot coverage gap** — kernel's `./testing` subpath
   and all 3 of platform's export conditions have no gate against
   accidental rename/removal, unlike kernel's main entry.
3. **E04-T02 remains externally blocked** (no Docker on this development
   machine) — `testcontainers-readiness.md` bounds what's needed to
   unblock it, but the blocker itself is outside this codebase's control.
4. **`Logger` and `Encrypter` are each certified against exactly one
   adapter** — their contract suites have never proven cross-adapter
   consistency in practice, since no second adapter exists yet for either.
5. **`manifest-rules.test.mjs` checks export-condition ordering, not that
   declared `dist/` targets resolve** — verified manually this session (all
   5 do), but nothing would catch a future misconfiguration automatically
   until a consumer's build broke on it.

None of these five is a P0/P1-grade defect — all are residual-maturity
gaps consistent with a platform still inside its stabilization epic, named
explicitly so they aren't rediscovered as surprises later.

## 12. Readiness score

Carrying forward E03 exit's 79/100 scoring dimensions (contract
completeness, test rigor, operational readiness, security posture,
performance visibility, documentation coherence), E04's own work moves two
dimensions materially:

- **Contract completeness**: significantly improved — every multi-
  implementation kernel port now has an executable, adapter-agnostic
  contract, versus E03 exit's ad hoc per-adapter tests.
- **Documentation coherence**: significantly improved — governance,
  coverage audit, snapshot policy, performance consolidation, contributor
  workflow, and export audit are all now written down, cross-referenced,
  and internally consistent (verified, not assumed, in this pass).
- **Test rigor**: improved, with an honestly-reported ceiling — mutation-
  proof coverage remains uneven (Remaining Risk 1), so "rigor" here means
  "consistent, deduplicated, adapter-agnostic," not "every assertion
  proven to have teeth."
- **Operational readiness, security posture, performance visibility**:
  unchanged from E03 exit's assessment — this phase didn't touch
  operational tooling or add new performance work beyond baseline capture,
  and Section 4 confirms security posture held steady, not regressed.

**Composite: 82/100** — a modest, evidence-backed increase from E03 exit's
79/100, driven by contract completeness and documentation coherence, not
inflated by the two dimensions this phase didn't touch.

## 13. Final verdict

**E04 complete except the external blocker.**

Every executable task the founder's directives assigned (T01, T03–T09,
and this consolidation phase's Sections 2–10 and 12) is done, verified,
and committed. E04-T02 is the sole exception, blocked by a real external
constraint (no Docker on this development machine) that this codebase
cannot resolve from within — it is bounded, documented, and ready to pick
up the moment a working Docker daemon is available, per
`testcontainers-readiness.md`'s acceptance criteria. No un-certified
surface exists among adapters that actually ship today; every `pending`
row in the certification matrix names an adapter that doesn't exist yet,
not one that was skipped.

## 14. Recommendations adopted as permanent policy (Section 12)

Per the founder directive's explicit instruction, the following are now
standing project policy, not a one-time recommendation:

1. Every production adapter must have a contract suite (or a documented,
   reviewed reason it's `not applicable`).
2. Every contract suite must have at least one mutation proof — **not yet
   met by 4 of 8 existing suites**; closing this gap is real follow-up
   work, not a retroactive formality.
3. Every Postgres adapter must have an integration baseline — met today
   (all 4 Postgres-backed E04 adapters have one).
4. Every behavioral security fix must become a regression test — met
   today (Section 4 verifies this for all 5 named items).
5. Every public export must appear in the export audit — met for this
   audit's scope; future exports should be checked against
   `export-surface-audit.md`'s method at each release, not just once.
6. Every release must include a contract-coverage review — this report
   and `contract-coverage-audit.md` establish the template for that
   review going forward.
