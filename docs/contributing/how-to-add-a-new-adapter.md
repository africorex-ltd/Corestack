# How to Add a New Adapter

- **Effort:** E04 Consolidation and Release-Hardening Mode, Section 9 —
  this becomes the canonical maintainer workflow for adding a new adapter
  to an existing kernel port (a second `Logger` backend, a KMS `Encrypter`,
  etc.) or, with light adaptation, a first adapter for a brand-new port.
- **Worked example used throughout:** `PostgresIdempotencyStore` (E03-T43)
  and its contract-suite conversion (E04-T09) — the cleanest, most
  representative case in this codebase, since every existing kernel test
  relocated into the shared suite with no scope narrowing needed.

## Before you start: confirm you actually need a contract suite

A contract suite is only worth building when a port has, or will have,
more than one implementation — its entire value is proving the same
behavior holds across adapters. If you're adding the *first and only*
implementation of something with no second adapter planned, write ordinary
unit tests instead and record the port as **not applicable** in the
certification matrix with the reason — see Health-check's entry in
`docs/testing/adapter-certification-matrix.md` for the template (a plain
function taking dependencies, not a port with swappable implementations).

## Step 1 — Define the adapter

- Implement the port's interface exactly as declared in the kernel (e.g.
  `IdempotencyStore`'s `begin`/`complete` methods) — don't add extra public
  methods that aren't part of the port unless they're adapter-specific
  operational concerns (pruning, schema bootstrap) that don't belong in the
  portable interface itself. `PostgresIdempotencyStore` is a useful
  reference: it implements exactly `IdempotencyStore`, with
  `pruneIdempotencyKeys`/`ensureIdempotencyKeysSchema` shipped as separate,
  standalone functions rather than extra interface methods.
- If the port's contract depends on time (most kernel ports here do),
  accept a `Clock` the same way existing adapters do — contract suites in
  this codebase assume a clock-injectable factory shape (see Step 2).
- Read the port's own doc comment (e.g. `kernel/src/idempotency-store.ts`)
  before writing anything — it is the normative source of what "correct"
  means, not any existing adapter's behavior. If your new adapter's
  natural behavior conflicts with the doc comment, that's a signal to stop
  and resolve the conflict deliberately (see Step 6's "breaking changes"
  note), not to silently follow whichever behavior your adapter happens to
  produce.

## Step 2 — Add a contract suite (or run the existing one)

If a shared suite already exists for this port (check
`packages/kernel/src/testing/index.ts`), you don't write a new suite — you
write a **factory** the existing `define*ContractSuite` function can call.
Factories in this codebase take whatever the adapter genuinely needs to be
constructed deterministically:

```ts
// packages/platform/test/integration/idempotency-store.postgres.test.ts (pattern)
defineIdempotencyStoreContractSuite(
  { describe, it, expect, beforeEach },
  (clock) => new PostgresIdempotencyStore(sql, { clock }),
);
```

If you're building the **first** contract suite for a port that doesn't
have one yet, follow `contract-governance.md`'s "How to add a new contract
suite" section in full — scope it to exactly what the port's doc comment
makes normative, not to every behavior your one adapter happens to have.
Adapter-specific extras (a capacity bound, a retry policy) stay as
adapter-specific tests, documented as deliberately excluded in the suite's
own file header.

**Never import a test runner as a value.** `SuiteHarness`'s fields are
typed via `import type` from `vitest` only — this is what keeps
`@corestack/kernel/testing` at zero added runtime dependencies (fitness-
test-enforced). Follow this pattern exactly for any new suite.

## Step 3 — Add integration tests

- Convert (don't duplicate) your adapter's own test file to call the
  shared suite, then add **only** what the suite can't cover:
  adapter-specific edge cases (e.g. `PostgresIdempotencyStore`'s 2-connection
  and 20-caller concurrency races — meaningful only against real shared
  storage, which a single-threaded in-memory adapter can't race with
  itself), migration/schema-bootstrap assertions, and true integration-only
  concerns (atomic commit/rollback, connection-pool behavior).
- If your adapter is Postgres-backed, verification means a **direct**
  `vitest run` against a real database (local `DATABASE_URL` or
  Testcontainers) — not just unit-level, in-process assertions. See
  `docs/testing/testcontainers-readiness.md` if Docker is unavailable in
  your environment; local `DATABASE_URL` mode is equally valid evidence.
- If you find and fix a real defect while converting (the way the
  `ProcessedEventStore` suite's initial UUID-vs-readable-id bug was caught
  against real Postgres, or the `Logger` redaction gap was caught by
  reading the port doc against actual adapter behavior), verify the fix by
  observing the assertion **fail** against the pre-fix code first — this is
  this codebase's standing empirical-verification discipline, not optional
  rigor. State which case you're in (found-and-fixed vs. suite-covers-
  behavior-no-adapter-ever-violated) in your suite's log entry (Step 6).

## Step 4 — Add a performance baseline

- Only Postgres-backed (or otherwise I/O-bound) adapters need a baseline —
  an in-memory `Map`-backed adapter's benchmark mostly measures V8/Node
  overhead, not anything actionable (see
  `docs/quality/performance/README.md`'s "what this document intentionally
  does not do").
- Reuse `packages/platform/bench/harness.ts`'s `measure()`/`writeBaseline()`
  — write to `PERFORMANCE_BASELINE_DIR` (`docs/quality/performance/`) via
  the optional `dir` parameter, following the existing four adapter
  benchmarks (`rate-limiter-consume.bench.ts` etc.) as templates: 5 warmup
  iterations, 50 timed iterations, one logical operation measured per call.
- **Do not add thresholds or CI gating.** Every benchmark in this
  repository stays outside `turbo.json` and every CI workflow — an
  unwired script that looks wired is worse than no script at all (see the
  outbox methodology doc's "no CI wiring" rationale, which applies
  verbatim here). Thresholds are deferred to E04-T13's future shared
  harness across the board, not decided per-adapter.

## Step 5 — Update the certification matrix

Add or update your adapter's row in
`docs/testing/adapter-certification-matrix.md`:

- **Certified** — the suite runs and every assertion passes against a real
  instance of your adapter (a real Postgres connection, not a stub).
- **Partial** — some but not all assertions pass, or a concurrency case
  only holds under a documented adjunct condition.
- **Pending** — the suite exists but your adapter hasn't been run against
  it yet.
- **Blocked** — an external constraint (no Docker, per
  `docs/testing/testcontainers-readiness.md`) prevents verification.
- **Not applicable** — don't force a status onto a pairing that doesn't
  make sense (see `Cache`'s Postgres column, deliberately "not applicable"
  under ADR-0018, not "pending").

The fitness rule in `packages/architecture-tests` (`contract-suite-adapter-
matrix.test.mjs`) will fail your build if your new adapter class isn't
listed here at all — this is mechanically enforced, not just a convention.

## Step 6 — Update the quality dashboard

- Update `docs/quality/dashboard.md`'s test-count row with **measured**
  numbers — run `vitest run` directly (not `turbo run test:integration`,
  which doesn't thread `DATABASE_URL` through to subprocesses on this
  project's setup) and use the real output, never an incremental estimate.
  A drift between an estimated and measured count was caught and corrected
  in this codebase's own history (commit `f3c0127`) — don't repeat it.
- If your change is behavioral (a new or tightened contract assertion that
  changes what a previously-certified adapter must do), write an ADR
  first — ADR-0022 (Logger runtime redaction) is the template: context,
  decision, consequences (including a check of every existing caller for
  breakage), alternatives considered.
- Add a suite-by-suite log entry to `docs/testing/contract-governance.md`'s
  "Suite-by-suite log" section: what was found, what was fixed, what was
  kept adapter-specific and why, the before/after test-count delta. This
  is the single most useful artifact for the *next* contributor doing this
  same workflow — write it as if they're reading it cold.

## Step 7 — Update the changelog

Add an entry under `CHANGELOG.md`'s `[Unreleased]` section. If the change
is a security-relevant regression fix, use the `SECURITY (ADR-XXXX): ...`
prefix convention already established (see ADR-0020's and ADR-0022's
entries) — this is how `docs/testing/contract-governance.md`'s "Required
evidence for behavior changes" and this project's broader security
follow-through discipline (`docs/releases/export-surface-audit.md`,
Section 8) stay checkable: every security-related regression should have a
test, a documented rationale, an ADR if behavioral, and a changelog entry
if user-visible — in that order, not as an afterthought.

## Checklist (copy this into your PR description)

- [ ] Adapter implements the port's interface exactly, with any extra
      operational methods (pruning, schema bootstrap) kept separate
- [ ] Contract suite factory written or reused; suite passes against a
      real instance (real Postgres, not a stub)
- [ ] Adapter-specific edge cases and concurrency adjuncts added, not
      duplicated into the shared suite
- [ ] Any found-and-fixed defect verified failing pre-fix, passing post-fix
- [ ] Performance baseline added (Postgres-backed adapters only), no
      thresholds, not wired into `turbo.json` or CI
- [ ] Certification matrix row added/updated
- [ ] Dashboard test counts refreshed via direct `vitest run`, not
      estimated
- [ ] ADR written if the change is behavioral; suite-by-suite log entry
      added to `contract-governance.md`
- [ ] CHANGELOG entry added under `[Unreleased]`, with `SECURITY (ADR-XXXX)`
      prefix if applicable
