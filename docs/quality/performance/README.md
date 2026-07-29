# Performance Baselines — Consolidated View

- **Effort:** E04 Consolidation and Release-Hardening Mode, Section 5.
- **Status:** Scaffolding — every number below is real and re-runnable, but
  none is CI-gated or threshold-enforced. That posture is deliberate and
  deferred to E04-T13's future shared benchmark harness (see each
  methodology doc's "Why no thresholds, retries, or CI wiring" section).
  **This document does not propose optimizing anything** — its only job is
  to put every current baseline in one place so a future optimization pass,
  or E04-T13's harness design, starts from a complete picture.

## Important: two baseline directories, not one

This repository has **two** separate benchmark efforts, sharing one harness
(`packages/platform/bench/harness.ts`) but writing to two different
locations, for a historical reason worth stating plainly rather than
implying a single unified location:

| Effort | Baseline directory | Methodology doc |
| --- | --- | --- |
| Outbox subsystem (6 benchmarks, pre-dates E04) | `docs/quality/architecture-benchmarks/baselines/outbox/` | [outbox-benchmark-methodology.md](../architecture-benchmarks/outbox-benchmark-methodology.md) |
| E04 contract-suite adapters (4 benchmarks) | `docs/quality/performance/` (this directory) | [contract-suite-adapter-benchmark-methodology.md](contract-suite-adapter-benchmark-methodology.md) |

Both run from the same `pnpm --filter @corestack/platform bench` command
(it picks up every `*.bench.ts` file); they are split by *directory*, not
by *command*. A future reader should not assume `docs/quality/performance/`
holds every benchmark this repository has — it holds only the four newest
ones. Unifying the two directories is a reasonable E04-T13 cleanup, not
something this consolidation pass does, since moving files without a reason
tied to that task would just be churn.

## All current baselines, one table

Captured on this local development machine against local PostgreSQL 18
(outbox benchmarks: 2026-07-28; contract-suite adapter benchmarks:
2026-07-29) — not CI hardware, not representative of production
performance. Every benchmark: 50 timed iterations (200 for
`relay-dispatch`, in-memory only) after 5 (200) untimed warmup iterations.

| Benchmark | Mean | p50 | p95 | p99 | ops/sec | Backing | Baseline file |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `rate-limiter-consume-fresh-bucket` | 0.35ms | 0.34ms | 0.50ms | 0.56ms | ~2,850 | Real Postgres | `performance/rate-limiter-consume-fresh-bucket.json` |
| `idempotency-store-begin-fresh-key` | 0.34ms | 0.32ms | 0.45ms | 0.51ms | ~2,930 | Real Postgres | `performance/idempotency-store-begin-fresh-key.json` |
| `processed-event-store-mark-fresh-id` | 0.30ms | 0.28ms | 0.41ms | 0.50ms | ~3,300 | Real Postgres | `performance/processed-event-store-mark-fresh-id.json` |
| `unit-of-work-run-single-event` | 0.74ms | 0.66ms | 1.10ms | 1.56ms | ~1,350 | Real Postgres | `performance/unit-of-work-run-single-event.json` |
| `write-outbox-events-batch-10` | 4.24ms | 3.39ms | 7.68ms | — | — | Real Postgres | `architecture-benchmarks/baselines/outbox/write-outbox-events.json` |
| `relay-poll-once-batch-10` | 4.80ms | 3.80ms | 8.43ms | — | — | Real Postgres | `architecture-benchmarks/baselines/outbox/relay-polling.json` |
| `relay-dispatch-batch-10-in-memory` | 0.95ms | 0.29ms | 3.12ms | — | — | In-memory | `architecture-benchmarks/baselines/outbox/relay-dispatch.json` |
| `checkpoint-advance` | 1.66ms | 1.11ms | 5.34ms | — | — | Real Postgres | `architecture-benchmarks/baselines/outbox/checkpoint-updates.json` |
| `processed-event-mark` | 1.39ms | 1.12ms | 3.08ms | — | — | Real Postgres | `architecture-benchmarks/baselines/outbox/processed-event-inserts.json` |
| `partition-maintenance-steady-state` | 3.56ms | 2.72ms | 8.45ms | — | — | Real Postgres | `architecture-benchmarks/baselines/outbox/partition-maintenance.json` |

`p99`/`ops/sec` are blank for the six outbox benchmarks' *table entries*
above for readability, not because the underlying JSON lacks them — the
`BenchStats` shape gained `p99Ms`/`opsPerSecond` retroactively (see the
outbox methodology doc's step 5) and all six JSON files were regenerated
with those fields; the actual numbers are in each file, omitted here only
because the outbox benchmarks measure a 10-event **batch** while the
contract-suite adapter benchmarks measure a **single call**, so the two
`ops/sec` figures aren't directly comparable side by side without that
context — see the contract-suite methodology doc's explanation of why
`opsPerSecond` was added only once single-operation benchmarks existed to
need it.

## Notable observations (not conclusions — first-baseline numbers)

- **`PostgresUnitOfWork.run` (0.74ms mean) is the slowest of the four new
  adapter benchmarks**, expected since it is the only one of the four that
  opens and commits an entire transaction (`sql.begin(...)`) rather than
  issuing one statement against the bare connection pool.
- **The gap between `relay-poll-once-batch-10` (~4.8ms) and
  `relay-dispatch-batch-10-in-memory` (~0.95ms)** is almost entirely
  Postgres round-trip cost, not relay-loop overhead — the two benchmarks
  were deliberately split apart to make this distinguishable.
- No regression or anomaly is being reported anywhere in this table — every
  number here is a first baseline, with nothing yet to compare it against
  across time. That comparison is exactly what E04-T13's harness is for.

## What this document intentionally does not do

- **It does not propose thresholds.** A number with nothing to compare
  against yet is not actionable; inventing a threshold now would be
  guessing, and both methodology docs are explicit about deferring
  threshold derivation to E04-T13, once several real runs exist.
- **It does not merge the two baseline directories.** See "two baseline
  directories" above.
- **It does not benchmark `Cache`, `Logger`, `EventBus`, or `Encrypter`.**
  None of the four currently has a Postgres-backed adapter — benchmarking
  an in-memory `Map`/`WebCrypto` call mostly measures V8 overhead, not
  anything a future optimization pass would act on. See
  [contract-coverage-audit.md](../../testing/contract-coverage-audit.md)'s
  residual-gaps section for the same point stated against the coverage
  audit.
