# Contract Coverage Audit

- **Effort:** E04 Consolidation and Release-Hardening Mode, Section 2.
- **Companions:** [adapter-certification-matrix.md](adapter-certification-matrix.md)
  (per-adapter status), [contract-governance.md](contract-governance.md)
  (how each status is earned).
- **Method:** every claim below was re-verified against current file
  contents for this audit — certified-status is not simply copied from the
  matrix without checking the underlying suite/test file still says what it
  claims to.

## How to read the "Mutation proof" column

This project's own definition (established in ADR-0022's fix and the
ProcessedEventStore UUID bug, both surfaced this session): a suite has
**mutation proof** when at least one of its assertions was observed to
**fail** against a real broken variant — either a genuine pre-fix defect in
shipped code, or a deliberately-broken fixture built to prove the assertion
has teeth. A suite built by relocating tests that were already passing,
with no fixture ever built to break them, has **no** mutation proof, even
if every individual assertion is correct. This is a stricter bar than "the
suite passes," and several suites below fall short of it — that gap is the
audit's most useful output, not a defect to paper over.

## Per-port coverage table

| Port | Contract suite exists? | Snapshot protection? | Integration parity? | Mutation proof? | Performance baseline? |
| --- | --- | --- | --- | --- | --- |
| `Cache` | Yes — `defineCacheContractSuite` (E04-T01) | Yes — `api-surface.test.ts` snapshots the `./` and `./testing` export lists; no `Cache`-behavior-specific snapshot (would violate snapshot-governance.md's "no behavior a contract suite already governs") | N/A — no Postgres adapter exists (ADR-0018) | **Yes** (added E05 readiness gate, 2026-07-30) — `NeverExpiringCache` fixture in `ports.test.ts` ignores `ttlMs`; one targeted assertion proves the shared suite's expiry check catches it | **No** — no Postgres adapter to benchmark; in-memory op not benchmarked |
| `RateLimiter` | Yes — `defineRateLimiterContractSuite` (E04-T01) | Yes (same export-list snapshot as `Cache`) | Yes — `PostgresRateLimiter` runs the shared suite via direct `vitest run` against real Postgres, plus a 20-caller concurrency adjunct | **Yes** (added E05 readiness gate, 2026-07-30) — `LexicographicRateLimiter` fixture reproduces, in pure JS, the exact string-vs-numeric comparison bug found and fixed for real in `PostgresRateLimiter` (E03-T41's untyped-SQL-parameter defect) | Yes — `rate-limiter-consume-fresh-bucket.json`, captured 2026-07-29 |
| `Logger` | Yes — `defineLoggerContractSuite` (T03) | Yes (export-list snapshot) | N/A — no Postgres/pino adapter exists yet (`pending`) | **Yes** — the suite's SECURITY redaction and Error-serialization assertions were written *because* both shipped adapters (`CaptureLogger`, `NoopLogger`) were observed failing them before ADR-0022's fix | **No** — no Postgres adapter; in-memory op not benchmarked |
| `EventBus` | Yes — `defineEventBusContractSuite` (T04) | Yes (export-list snapshot) | N/A — outbox relay is a deliberately separate mechanism, not a second `EventBus` (ADR-0009) | **Partial** — only the ordering assertion has a documented broken-fixture proof (`ReverseOrderEventBus` in `event-bus.test.ts`); the other ~7 assertions (wildcard, version filter, every-handler-attempted, unsubscribe, context propagation, no-dedup) have no observed failure on record | **No** — no Postgres adapter; in-memory op not benchmarked |
| `UnitOfWork` | Yes — `defineUnitOfWorkContractSuite` (T05) | Yes (export-list snapshot) | Yes — `PostgresUnitOfWork` runs the shared suite with `drainDispatched()` backed by a real `OutboxRelay.pollOnce()` against real Postgres (first end-to-end proof of `UnitOfWork` → `outbox` → relay in this codebase), plus atomic-commit/rollback/nesting-rejection adjuncts | **No, deliberately deferred** (reviewed E05 readiness gate, 2026-07-30) — see "UnitOfWork mutation-proof: why deferred" below; a fixture built solely to violate these assertions would not model a plausible real implementation mistake the way the other three fixtures do | Yes — `unit-of-work-run-single-event.json`, captured 2026-07-29 |
| `Encrypter` | Yes — `defineEncrypterContractSuite` (T06) | Yes (export-list snapshot) | N/A — only one implementation exists (`WebCryptoAesGcmEncrypter`); KMS adapter is `pending`, not built | **Yes** (added E05 readiness gate, 2026-07-30) — `FixedIvEncrypter` fixture reuses an all-zero IV every call, reproducing one of the single most common real-world AES-GCM misimplementations; one targeted assertion proves the IV-uniqueness check catches it | **No** — no Postgres adapter; in-memory/WebCrypto op not benchmarked |
| `ProcessedEventStore` | Yes — `defineProcessedEventStoreContractSuite` (T07) | Indirect only (kernel export surface) | Yes — `PostgresProcessedEventStore` runs the shared suite via direct `vitest run` against real Postgres, plus a 10-caller concurrency adjunct | **Yes** — the suite's first version (readable-literal ids) was observed failing all 6 assertions against real Postgres (`invalid input syntax for type uuid`) before the UUID fix landed | Yes — `processed-event-store-mark-fresh-id.json`, captured 2026-07-29 |
| `IdempotencyStore` | Yes — `defineIdempotencyStoreContractSuite` (T09) | Indirect only (kernel export surface) | Yes — `PostgresIdempotencyStore` runs the shared suite via direct `vitest run` against real Postgres, plus 2-connection and 20-caller concurrency adjuncts | **Yes** (partial, historical) — the suite includes the ADR-0020 cross-tenant SECURITY test, which was itself mutation-proven in E03 when the P0 cross-tenant replay vulnerability was found and fixed; no other assertion in the suite has an independent proof | Yes — `idempotency-store-begin-fresh-key.json`, captured 2026-07-29 |
| Health-check (`checkLiveness`/`checkReadiness`) | **N/A by design** — plain functions, not a port with swappable implementations (see certification matrix) | **Yes, directly** — 3 `toMatchSnapshot()` tests in `health-readiness.test.ts` pin the exact JSON shape (minimal, fully-configured, liveness) | N/A — no adapter to certify | N/A — not applicable to a non-port function; existing per-field assertions cover correctness, snapshots cover shape-drift only | N/A — not a Postgres-backed adapter |

## What "certified" in the matrix does and doesn't mean

Read against this table, "certified" in `adapter-certification-matrix.md`
means **the suite runs and passes against a real instance of the adapter**
— it does not mean every individual assertion has been proven to catch a
real regression. That distinction matters for Section 12's proposed
permanent policy ("every contract suite must have at least one mutation
proof"): as of the **E05 readiness gate (2026-07-30)**, that bar is met by
`Logger`, `ProcessedEventStore`, `IdempotencyStore` (historically), `Cache`,
`RateLimiter`, and `Encrypter`. `EventBus` remains partial. `UnitOfWork` is
the sole suite with a **deliberate, reasoned deferral** rather than a gap —
see below.

## UnitOfWork mutation-proof: why deferred, not added

The E04 audit originally listed `UnitOfWork` alongside `Cache`,
`RateLimiter`, and `Encrypter` as lacking mutation proof. The E05 readiness
gate reviewed all four for whether to close this and closed three; this
one was deliberately left open, because the four are not actually
equivalent.

`Cache`'s never-expiring fixture, `RateLimiter`'s string-comparison
fixture (which reproduces a bug that **actually happened** in
`PostgresRateLimiter`), and `Encrypter`'s fixed-IV fixture all share a
property: each models a **plausible, silent** implementation mistake — code
that looks correct under casual testing (values round-trip, requests get
allowed/denied, ciphertext decrypts) and only fails the *specific*
contract assertion the shared suite checks. That's exactly the class of
bug a contract suite exists to catch.

`UnitOfWork`'s three assertions (`run()` returns the callback's result;
staged events dispatch only after commit, in order; staged effects are
discarded entirely when `work` throws) don't have an equivalent silent-
mistake shape. A fixture built to violate "dispatch only after commit" —
e.g. one that publishes events the instant `tx.publish()` is called,
before any commit — would fail *immediately and obviously* under the most
basic manual testing (published events show up before the transaction
even resolves). It isn't a mistake that could plausibly ship and pass
casual review; it's a fixture built solely to be wrong, with no
relationship to how a real `UnitOfWork` adapter (in-memory, Postgres, or
any future adapter) could plausibly be implemented incorrectly and still
look right. Building one anyway would be exactly the "weak or artificial
mutation test" this gate's own directive warned against.

This is recorded as a **deliberate deferral**, not a gap: if a genuinely
plausible silent-mistake shape for `UnitOfWork` is identified later (for
instance, once a second real adapter beyond `PostgresUnitOfWork` exists and
reveals a real implementation hazard the way E03-T41 did for
`RateLimiter`), add the fixture then, grounded in that real case — not
speculatively now.

## Residual gaps (highlighted per Section 2's request, updated 2026-07-30)

1. **`UnitOfWork` has no mutation proof, by deliberate choice.** See above.
   This is the only suite in this state after the E05 readiness gate; it
   is tracked as a considered deferral, not treated as closed.
2. ~~No export-surface snapshot for `@corestack/kernel/testing` or any
   platform subpath.~~ **Closed 2026-07-30** (E05 readiness gate, Section 4)
   — kernel's `api-surface.test.ts` now covers `.` and `./testing`;
   platform's new `api-surface.test.ts` covers all three of its conditions
   (`.`, `./postgres`, `./testing`). All 5 declared export conditions
   across both packages are now snapshotted — see
   `docs/testing/snapshot-governance.md`'s "Export-surface snapshot
   coverage" section.
3. **`Logger` and `Encrypter` are each certified against exactly one
   adapter.** Their Postgres/pino and KMS counterparts are named in the
   respective port docs as planned but not built — the matrix correctly
   marks these `pending`, not a gap in the suites themselves, but it means
   neither suite has ever proven cross-adapter consistency (a contract
   suite's core value proposition) in practice yet.
4. **No performance baseline exists for `Cache`, `Logger`, `EventBus`, or
   `Encrypter`.** This is not an oversight — none of the four has a
   Postgres-backed adapter to benchmark under realistic I/O conditions, and
   benchmarking an in-memory `Map`/`WebCrypto` operation mostly measures
   V8/Node overhead rather than anything actionable. Named here so a future
   reader doesn't mistake "no baseline" for "not measured yet."

## Un-certified surface

None. Every kernel port with more than one implementation has a contract
suite, and every existing adapter for those ports is certified against it
(see the matrix). The only adapters not certified are ones that **don't
exist yet** (Postgres/pino `Logger`, KMS `Encrypter`) — correctly recorded
as `pending`, not silently missing.
