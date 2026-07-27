# Remediation Log

Structured record for every audit finding (governance §1, §5). Source
findings: [11-staff-audit-2026-07.md](../engineering/11-staff-audit-2026-07.md).

---

## AUD-01 — CI integration lane was a green no-op

- **Severity:** P0 (CI integrity) · **Status:** ✅ Resolved
- **Root cause:** the integration job was scaffolded ahead of any package
  defining `test:integration`; turbo matches zero tasks and exits 0. Process
  gap: no rule required a lane to prove it ran work.
- **Impact / risk:** a required check that cannot fail — false confidence on
  every PR; the exact failure mode the isolation-suite philosophy targets.
- **Fix:** `tooling/scripts/assert-turbo-tasks.mjs` — fails any lane whose
  matched-task set is below a minimum (`test`, min 3) or diverges from a
  **versioned expectation manifest** (`test:integration` ↔
  `tooling/ci/integration-manifest.json`, exact match both directions).
- **Behaviour before → after:** vacuous pass → explicit, versioned
  expectation; adding/removing a suite without updating the manifest fails.
- **Tests:** guard exercised in CI itself (both modes run on every PR);
  negative behavior verified by design (exact-match both directions).
- **Related:** governance §4; blueprint E03-T02 (first manifest entry);
  no ADR impact. **Remaining risk:** none for this class; guard extends to
  future lanes by one line.

## AUD-02 — `idempotentHandler` encoded at-most-once

- **Severity:** P0 (data integrity / ADR-0009 compliance) · **Status:** ✅ Resolved
- **Root cause:** mark-before-handle ordering; the atomic-claim shape
  (`markIfNew`) was borrowed from in-transaction designs where claim and
  effects commit together — without the transaction, the ordering silently
  became at-most-once.
- **Impact / risk:** permanent event loss on transient handler failure —
  audit gaps, undelivered webhooks; would have been fossilized into the E04
  contract suites as "correct".
- **Fix:** port reshaped to `hasProcessed`/`markProcessed`; handler marks
  **after** success; TSDoc states the duplicate window and the durable-adapter
  obligation (mark atomically with effects, in-tx).
- **Behaviour before → after:** failed event lost forever → failed event
  stays unmarked and retries on redelivery (at-least-once); duplicates
  possible only in the crash window durable adapters close.
- **Tests:** `AUD-02 regression` in `unit-of-work.test.ts` — fails on the old
  ordering, proves retry-after-failure and no-op-after-success.
- **Related:** ADR-0009 (protected, not changed); kernel export snapshot
  unchanged (type-level rename only — pre-publish, no consumer exists).
- **Remaining risk:** durable-adapter atomicity is contractual until E03-T14
  implements and contract-tests it.

## AUD-03 — `InMemoryUnitOfWork` failed producers on consumer errors

- **Severity:** P0 (architecture violation — reference diverged from ADR-0009) · **Status:** ✅ Resolved
- **Root cause:** synchronous in-process dispatch conflated "publish" with
  "consume"; the reference let consumer exceptions propagate into the
  producer's result after logical commit.
- **Impact / risk:** every application test written against the reference
  would encode wrong expectations (use cases failing on audit-consumer bugs);
  semantic drift multiplying across all future modules.
- **Fix:** dispatch failures are isolated; optional `onDispatchError`
  observer (default: swallow — production's relay owns retries). Behavioural
  change documented in TSDoc with the ADR-0009 rationale.
- **Behaviour before → after:** `run()` rejected after commit → `run()`
  resolves; failures observable, never producer-fatal.
- **Tests:** `AUD-03 regression` in `unit-of-work.test.ts` (would fail on old
  behavior); rollback-discard test retained.
- **Related:** ADR-0009; Architecture §13. **Remaining risk:** none; the
  Postgres UoW adapter inherits the contract via E04 suites.

## AUD-04 — Live release workflow without credentials; un-pinned actions

- **Severity:** P0 (CI integrity / supply chain) · **Status:** ✅ Resolved
- **Root cause:** workflows went live at repo creation while SHA-pinning and
  npm setup were scheduled "later" (E01-T05/T15) — the schedule didn't move
  when the go-live date did.
- **Fix:** release job gated on `vars.RELEASE_ENABLED == 'true'` (skips
  visibly until the founder enables it); **every** action across all three
  workflows pinned to commit SHAs resolved from upstream tags
  (checkout `11d5960a`, setup-node `49933ea5`, pnpm/action-setup `b906affc`,
  codeql `4187e74d`, changesets `a45c4d59` v1.9.0); Renovate `pinDigests`
  keeps them current.
- **Behaviour before → after:** failing publish attempts + tag-tracking
  actions → visibly-skipped release until enabled + immutable action revs.
- **Related:** blueprint E01-T05/T15 (partially delivered early);
  09-release-versioning §1. **Remaining risk:** npm org/token remain the
  external blocker (stop condition, flagged).

## AUD-05 — Rate-limiter unbounded bucket map

- **Severity:** P1 (memory; attacker-influencable) · **Status:** ✅ Resolved
- **Fix:** windows carry `windowEnd`; at-cap opportunistic pruning of expired
  windows + oldest-eviction bound (`maxBuckets`, default 10 000);
  `bucketCount` exposed for observability. Trade-off documented: an evicted
  live bucket restarts its window — bounded memory over unbounded precision.
- **Tests:** two `AUD-05` regressions (prune at cap; bounded when all live).
- **Remaining risk:** eviction-restart is a theoretical limiter-reset vector
  at >10k concurrent live buckets — Postgres/Redis adapters (durable, shared)
  are the production answer at that scale; noted for the E04 contract suite.

## AUD-06 — Kernel publish-readiness gaps

- **Severity:** P1 · **Status:** ✅ Resolved — `repository`/`homepage`/`bugs`/
  `keywords`/`engines` added, description refreshed, LICENSE shipped in the
  tarball (`files`), all now enforced repo-wide by the manifest fitness tests.

## AUD-08 — Duplicated sensitive-key deny-lists

- **Severity:** P1 (consistency/security drift) · **Status:** ✅ Resolved —
  mechanical set-equality test (`sensitive-keys-sync.test.mjs`) parses both
  sources textually (lint config must work pre-build, so no import coupling);
  drift now fails CI.

## AUD-09 — `CaptureLogger` readonly-cast hack

- **Severity:** P1→P2 (maintainability) · **Status:** ✅ Resolved — explicit
  shared-sink constructor; behavior identical, existing tests unchanged.

## AUD-10 — Envelope immutability was convention-only

- **Severity:** P1 (correctness under composition) · **Status:** ✅ Resolved —
  `Object.freeze` in context/event factories (actor copied+frozen);
  regressions assert mutation throws. Documented shallow-freeze boundaries:
  `payload` immutability is the emitter's duty; `Date` internals can't be
  frozen — readonly types + review cover mutators.

## AUD-11 — Stale/overlapping overview doc

- **Severity:** P1 (documentation drift) · **Status:** ✅ Resolved —
  overview.md rewritten as a dated, thin summary deferring to
  ARCHITECTURE.md; one-source-per-fact restored.

## AUD-13 — `pnpm audit` as PR gate

- **Severity:** P2 · **Status:** ✅ Resolved early (rode along with AUD-04's
  workflow rewrite — same file, same concern class): audit runs on main +
  weekly schedule; Renovate owns remediation; CodeQL stays on PRs.

## Open / scheduled

| ID                 | Disposition                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| AUD-07             | E06 design decision (auth-bucket algorithm) — noted in rate-limiter TSDoc                      |
| AUD-12             | Fitness tests already block runtime deep-imports; full types-only lint at E01-T02.4 (E05 gate) |
| AUD-14/15/16/18/19 | Folded into blueprint tasks (see audit §3 Batch 3)                                             |
| AUD-17             | Governance watch item (bus factor) — revisit at first maintainer addition                      |
