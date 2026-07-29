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
| `Cache` | Yes — `defineCacheContractSuite` (E04-T01) | Indirect only — kernel's `api-surface.test.ts` would catch a removed/renamed export, but nothing snapshots `Cache`-specific behavior | N/A — no Postgres adapter exists (ADR-0018) | **No** — suite extracted from already-passing `InMemoryLruCache` tests; no observed pre-fix failure or broken fixture on record | **No** — no Postgres adapter to benchmark; in-memory op not benchmarked |
| `RateLimiter` | Yes — `defineRateLimiterContractSuite` (E04-T01) | Indirect only (same as `Cache`) | Yes — `PostgresRateLimiter` runs the shared suite via direct `vitest run` against real Postgres, plus a 20-caller concurrency adjunct | **No** — same relocation-only history as `Cache` | Yes — `rate-limiter-consume-fresh-bucket.json`, captured 2026-07-29 |
| `Logger` | Yes — `defineLoggerContractSuite` (T03) | Indirect only (kernel export surface) | N/A — no Postgres/pino adapter exists yet (`pending`) | **Yes** — the suite's SECURITY redaction and Error-serialization assertions were written *because* both shipped adapters (`CaptureLogger`, `NoopLogger`) were observed failing them before ADR-0022's fix | **No** — no Postgres adapter; in-memory op not benchmarked |
| `EventBus` | Yes — `defineEventBusContractSuite` (T04) | Indirect only (kernel export surface) | N/A — outbox relay is a deliberately separate mechanism, not a second `EventBus` (ADR-0009) | **Partial** — only the ordering assertion has a documented broken-fixture proof (`ReverseOrderEventBus` in `event-bus.test.ts`); the other ~7 assertions (wildcard, version filter, every-handler-attempted, unsubscribe, context propagation, no-dedup) have no observed failure on record | **No** — no Postgres adapter; in-memory op not benchmarked |
| `UnitOfWork` | Yes — `defineUnitOfWorkContractSuite` (T05) | Indirect only (kernel export surface) | Yes — `PostgresUnitOfWork` runs the shared suite with `drainDispatched()` backed by a real `OutboxRelay.pollOnce()` against real Postgres (first end-to-end proof of `UnitOfWork` → `outbox` → relay in this codebase), plus atomic-commit/rollback/nesting-rejection adjuncts | **No** — all three assertions (result-return, dispatch-order, discard-on-throw) were relocations of already-passing tests; no broken fixture built for any of them | Yes — `unit-of-work-run-single-event.json`, captured 2026-07-29 |
| `Encrypter` | Yes — `defineEncrypterContractSuite` (T06) | Indirect only (kernel export surface) | N/A — only one implementation exists (`WebCryptoAesGcmEncrypter`); KMS adapter is `pending`, not built | **No** — tamper-detection and IV-uniqueness are newly-asserted real behaviors, but no pre-fix failure or broken fixture was recorded when they were added; they passed on first run | **No** — no Postgres adapter; in-memory/WebCrypto op not benchmarked |
| `ProcessedEventStore` | Yes — `defineProcessedEventStoreContractSuite` (T07) | Indirect only (kernel export surface) | Yes — `PostgresProcessedEventStore` runs the shared suite via direct `vitest run` against real Postgres, plus a 10-caller concurrency adjunct | **Yes** — the suite's first version (readable-literal ids) was observed failing all 6 assertions against real Postgres (`invalid input syntax for type uuid`) before the UUID fix landed | Yes — `processed-event-store-mark-fresh-id.json`, captured 2026-07-29 |
| `IdempotencyStore` | Yes — `defineIdempotencyStoreContractSuite` (T09) | Indirect only (kernel export surface) | Yes — `PostgresIdempotencyStore` runs the shared suite via direct `vitest run` against real Postgres, plus 2-connection and 20-caller concurrency adjuncts | **Yes** (partial, historical) — the suite includes the ADR-0020 cross-tenant SECURITY test, which was itself mutation-proven in E03 when the P0 cross-tenant replay vulnerability was found and fixed; no other assertion in the suite has an independent proof | Yes — `idempotency-store-begin-fresh-key.json`, captured 2026-07-29 |
| Health-check (`checkLiveness`/`checkReadiness`) | **N/A by design** — plain functions, not a port with swappable implementations (see certification matrix) | **Yes, directly** — 3 `toMatchSnapshot()` tests in `health-readiness.test.ts` pin the exact JSON shape (minimal, fully-configured, liveness) | N/A — no adapter to certify | N/A — not applicable to a non-port function; existing per-field assertions cover correctness, snapshots cover shape-drift only | N/A — not a Postgres-backed adapter |

## What "certified" in the matrix does and doesn't mean

Read against this table, "certified" in `adapter-certification-matrix.md`
means **the suite runs and passes against a real instance of the adapter**
— it does not mean every individual assertion has been proven to catch a
real regression. That distinction matters for Section 12's proposed
permanent policy ("every contract suite must have at least one mutation
proof"): as of this audit, that bar is met by `Logger`, `ProcessedEventStore`,
and (historically) `IdempotencyStore`. It is **not yet met** by `Cache`,
`RateLimiter`, `Encrypter`, or `UnitOfWork`, and only partially met by
`EventBus`. This is a real residual gap, not a rounding error — see
Residual Gaps below.

## Residual gaps (highlighted per Section 2's request)

1. **Mutation-proof coverage is uneven.** Four suites (`Cache`,
   `RateLimiter`, `Encrypter`, `UnitOfWork`) and one adjacent fitness rule
   area have zero on-record proof that their assertions would catch a
   real regression, as opposed to merely matching current adapter
   behavior. If Section 12's policy is adopted permanently, closing this
   gap (retroactively, for suites that already exist) is real follow-up
   work, not a one-time audit note.
2. **No export-surface snapshot for `@corestack/kernel/testing` or any
   platform subpath.** Kernel's `api-surface.test.ts` snapshots the main
   entry point's exports only — the `./testing` subpath (all 8 contract
   suites, now genuine public API) has no equivalent gate. Platform has
   **no export-surface snapshot test at all**, for any of its three
   subpaths (`.`, `./postgres`, `./testing`) — see Section 7's audit for
   the full detail.
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
