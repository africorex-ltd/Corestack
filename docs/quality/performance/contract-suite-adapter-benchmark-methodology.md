# Contract-Suite Adapter Benchmark Methodology

- **Status:** Scaffolding — benchmarks are real and runnable; thresholds and CI gating are explicitly deferred to E04-T13 (same posture as the outbox subsystem's benchmarks)
- **Scope:** the four Postgres-backed kernel-port adapters certified in the E04 executable-contracts effort — `PostgresRateLimiter`, `PostgresIdempotencyStore`, `PostgresProcessedEventStore`, `PostgresUnitOfWork`
- **Scripts:** `packages/platform/bench/{rate-limiter-consume,idempotency-store-begin,processed-event-store-mark,unit-of-work-run}.bench.ts`
- **Baselines:** `docs/quality/performance/*.json`
- **Shared harness:** [packages/platform/bench/harness.ts](../../../packages/platform/bench/harness.ts) — the same `measure`/`writeBaseline` utility the outbox subsystem's benchmarks use (see [outbox-benchmark-methodology.md](../architecture-benchmarks/outbox-benchmark-methodology.md)), extended with a `dir` parameter on `writeBaseline` so these benchmarks write here instead of the outbox baseline directory, and with `p99Ms`/`opsPerSecond` fields on `BenchStats` (both benchmark sets now report all three)

## Why this exists now, without thresholds

Per Section 14 of the founder's contract-suite directive: "capture a
baseline... do not optimise yet; establish measurements." Same rationale
as the outbox subsystem's benchmarks — a number with nothing to compare
against isn't actionable, and these exist to give each newly-certified
adapter a comparable, re-runnable baseline before any optimization work
would be justified, not to gate CI. Threshold enforcement stays deferred
to E04-T13's shared benchmark harness, the same as every other
benchmark in this repository.

## What is benchmarked

| Script                                | Measures                                                                                          | Backing        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------- |
| `rate-limiter-consume.bench.ts`        | `PostgresRateLimiter.consume` — one atomic UPSERT against a fresh bucket each call                 | Real Postgres  |
| `idempotency-store-begin.bench.ts`     | `PostgresIdempotencyStore.begin` — the `started` path, a fresh `(org, scope, key)` each call        | Real Postgres  |
| `processed-event-store-mark.bench.ts` | `PostgresProcessedEventStore.markProcessed` — the `INSERT` path, a fresh event id each call          | Real Postgres  |
| `unit-of-work-run.bench.ts`           | `PostgresUnitOfWork.run` — open transaction, stage one event into `platform.outbox`, commit         | Real Postgres  |

Each measures exactly one logical operation per timed call (no fixed-size
batches, unlike the outbox subsystem's 10-event-batch benchmarks), which
is what makes `opsPerSecond` (`1000 / meanMs`) a meaningful single-call
throughput estimate for all four — the outbox benchmarks that measure a
10-event batch would need a different `opsPerSecond` interpretation (per
batch vs. per event), which is why that field was added only once a set
of genuinely single-operation benchmarks existed to need it.

**Concurrency benchmarks are out of scope here, on purpose.** Each
script's own integration test suite already proves concurrent-caller
correctness under load (`RateLimiter`'s 20-caller race,
`IdempotencyStore`'s 2-connection and 20-caller races,
`ProcessedEventStore`'s 10-caller race) — that is a correctness property,
already verified. A *throughput-under-concurrency* number is a different,
legitimate question this scaffolding doesn't answer; it would need a
dedicated load-generation harness (multiple real connections, sustained
load, not `Promise.all` over a handful of calls) that doesn't exist yet
and is exactly the kind of thing E04-T13's shared harness should decide
how to build once, for every adapter, rather than each benchmark file
improvising its own.

## Methodology

Identical to the outbox subsystem's benchmarks (same harness, same
discipline):

1. Boots a fresh, isolated Postgres target via the dual-mode
   `createTestDatabase()` bootstrap.
2. Bootstraps the relevant schema fresh per benchmark file.
3. Runs 5 untimed warmup iterations.
4. Runs 50 timed iterations, recording wall-clock duration per iteration
   via `performance.now()`.
5. Computes mean, p50, p95, p99, min, max, and `opsPerSecond` across the
   timed iterations.
6. Writes the result as JSON to `docs/quality/performance/<name>.json` and
   prints a one-line summary to stdout. Each file is **overwritten** on
   every run — it holds the most recent measurement, not a history, same
   as the outbox baselines.

## Why no thresholds, retries, or CI wiring

Identical reasoning to the outbox subsystem's benchmarks — see
[outbox-benchmark-methodology.md](../architecture-benchmarks/outbox-benchmark-methodology.md)'s
"Why no thresholds, retries, or CI wiring" section; it applies verbatim
here. These four scripts are picked up by the same `bench` npm script
(`bench/**/*.bench.ts`), which stays outside `turbo.json` and every CI
workflow for the same silent-success-guard reason.

## How to run

```bash
pnpm --filter @corestack/platform bench
```

Runs every `*.bench.ts` file, including both the outbox subsystem's six
and these four. Requires either a reachable local Postgres via
`DATABASE_URL` or a working Docker daemon for the Testcontainers
fallback.

## Baseline provenance

**Captured 2026-07-29** on this local development machine, against a
local PostgreSQL 18 instance via `DATABASE_URL` — not CI hardware, not
representative of production performance. All four benchmarks ran
cleanly with the isolated scratch-database bootstrap.

| Benchmark                              | Mean   | p50    | p95    | p99    | ops/sec |
| ---------------------------------------- | ------ | ------ | ------ | ------ | ------- |
| `rate-limiter-consume-fresh-bucket`      | 0.35ms | 0.34ms | 0.50ms | 0.56ms | ~2,850  |
| `idempotency-store-begin-fresh-key`      | 0.34ms | 0.32ms | 0.45ms | 0.51ms | ~2,930  |
| `processed-event-store-mark-fresh-id`    | 0.30ms | 0.28ms | 0.41ms | 0.50ms | ~3,300  |
| `unit-of-work-run-single-event`          | 0.74ms | 0.66ms | 1.10ms | 1.56ms | ~1,350  |

All four are single round-trip operations against a warm local Postgres
instance, sub-millisecond except `PostgresUnitOfWork.run` — expected,
since it's the only one of the four that opens and commits an entire
transaction (`sql.begin(...)`) rather than issuing one statement on the
bare connection pool. No regression or anomaly to report; these are
first-baseline numbers, same posture as the outbox subsystem's own first
run.

A meaningful cross-environment baseline (CI runners, representative
production hardware, sustained concurrent load) is exactly what E04-T13
should establish; this one exists to give a future optimization pass a
same-machine number to compare against.
