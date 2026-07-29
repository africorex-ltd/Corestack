# Outbox Benchmark Methodology

- **Status:** Scaffolding — benchmarks are real and runnable; thresholds and CI gating are explicitly deferred to E04-T13
- **Scope:** `writeOutboxEvents`, relay polling, relay dispatch loop, checkpoint updates, processed-event inserts, partition maintenance
- **Scripts:** `packages/platform/bench/*.bench.ts`
- **Baselines:** `docs/quality/architecture-benchmarks/baselines/outbox/*.json`

## Why this exists now, without thresholds

Per the founder's Infrastructure Consolidation directive (section 3): "Add
benchmark scaffolding... Do not optimise yet. Store the methodology and
baseline locations." This document and the scripts it describes exist to
give the outbox subsystem a comparable, re-runnable performance baseline
**before** any optimization work is justified or attempted — optimizing
without a baseline is optimizing blind. Turning these numbers into CI-gated
budgets (the pattern the kernel's hot paths already use — see the quality
dashboard's benchmarks section) is explicitly out of scope until E04-T13
builds the shared benchmark harness and gating infrastructure for the
whole repo. Until then, this is a local, manually-run tool.

## What is benchmarked

| Script                             | Measures                                                                                                                                           | Backing                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `write-outbox-events.bench.ts`     | `writeOutboxEvents(sql, events)` inserting a 10-event batch                                                                                        | Real Postgres (dual-mode bootstrap — local or Testcontainers) |
| `relay-polling.bench.ts`           | One full `OutboxRelay.pollOnce()` round (checkpoint read, fetch, no-op dispatch, checkpoint advance) against a fresh 10-event batch each iteration | Real Postgres (dual-mode bootstrap — local or Testcontainers) |
| `relay-dispatch.bench.ts`          | The relay's own dispatch-loop overhead in isolation, backed by an in-memory fake store — separates relay logic cost from Postgres I/O cost         | In-memory (no Testcontainers)                                 |
| `checkpoint-updates.bench.ts`      | `PostgresOutboxRelayStore.advanceCheckpoint`                                                                                                       | Real Postgres (dual-mode bootstrap — local or Testcontainers) |
| `processed-event-inserts.bench.ts` | `PostgresProcessedEventStore.markProcessed` (fresh event id each call, never the `ON CONFLICT` path)                                               | Real Postgres (dual-mode bootstrap — local or Testcontainers) |
| `partition-maintenance.bench.ts`   | `maintainOutboxPartitions`'s steady-state create-ahead path (partitions already exist, call is a `pg_inherits` read plus idempotent no-op DDL)     | Real Postgres (dual-mode bootstrap — local or Testcontainers) |

`relay-polling` and `relay-dispatch` deliberately measure different
things: `relay-polling` is what a deployment actually experiences (full
Postgres round trip per poll), while `relay-dispatch` isolates whether a
future regression came from the relay's own loop or from the store/I/O
layer — a widening gap between the two over time would point at Postgres
call overhead rather than relay logic.

**Retention-drop is not benchmarked.** Its cost is dominated by how many
partitions happen to be eligible for drop in a given run — not a fixed
quantity — so a synthetic "drop N partitions" number would not be
comparable across runs in a meaningful way. If retention-drop performance
ever becomes a concern, a dedicated benchmark can be added then, sized to
match a real deployment's partition-count profile.

## Methodology

Each benchmark:

1. Boots a fresh, isolated Postgres target via the dual-mode
   `createTestDatabase()` bootstrap — a scratch database on a local
   instance if `DATABASE_URL` is set, otherwise a fresh
   `postgres:16-alpine` Testcontainer (except `relay-dispatch`, which
   needs no database).
2. Bootstraps the outbox schema fresh per benchmark file
   (`ensureOutboxSchema`).
3. Runs 5 (200 for `relay-dispatch`, which is cheap and in-memory) untimed
   warmup iterations to let JIT/connection-pool warm-up settle before
   measurement starts.
4. Runs 50 (200 for `relay-dispatch`) timed iterations, recording
   wall-clock duration per iteration via `performance.now()`.
5. Computes mean, p50, p95, p99, min, max, and `opsPerSecond` across the
   timed iterations (`p99Ms`/`opsPerSecond` added when the E04 contract-
   suite adapter benchmarks reused this harness — see
   [contract-suite-adapter-benchmark-methodology.md](../performance/contract-suite-adapter-benchmark-methodology.md)).
6. Writes the result as JSON to
   `docs/quality/architecture-benchmarks/baselines/outbox/<name>.json`
   (see [harness.ts](../../../packages/platform/bench/harness.ts)) and
   prints a one-line summary to stdout.

Each JSON baseline file is **overwritten** on every run — it holds the
_most recent_ measurement, not a history. If trend tracking across runs
becomes valuable, that is a natural extension for whoever builds the
E04-T13 harness (e.g. appending to a series rather than overwriting), not
something this scaffolding commits to today.

## Why no thresholds, retries, or CI wiring

- **No thresholds:** a number with nothing to compare against is not
  actionable, and picking a threshold before a single real baseline exists
  would be guessing. Once E04-T13's harness exists, thresholds should be
  derived from the first several real baseline runs, not invented here.
- **No CI wiring:** the `bench` npm script is intentionally **not** added
  to `turbo.json`'s pipeline and **not** called by any CI workflow. This is
  deliberate, not an oversight — an unwired task that _looks_ wired (a
  script that exists but nothing calls) is exactly the class of
  silent-success bug the project's own `assert-turbo-tasks` CI guard
  exists to catch elsewhere (see AUD-01 in the
  [remediation log](../remediation-log.md)). Keeping `bench` outside both
  `turbo.json` and the CI workflow means there is no lane that could
  silently stop running it.
- **No file-parallelism:** the `bench` npm script runs with
  `--no-file-parallelism`. In local mode (a shared Postgres instance, one
  throwaway database per file) this is no longer strictly required for
  correctness — each file's scratch database is isolated — but it keeps
  the same conservative posture as `test:integration`'s Testcontainers
  fallback, where this machine's Docker memory ceiling made concurrent
  containers unreliable (documented in project memory).

## How to run

```bash
pnpm --filter @corestack/platform bench
```

Requires either a reachable local Postgres via `DATABASE_URL` (see
[postgres-18-compatibility.md](../../platform/postgres-18-compatibility.md))
or a working Docker daemon for the Testcontainers fallback — see the
package README's Testing guide for the dual-mode bootstrap.

## Baseline provenance

**Captured 2026-07-28** on this local development machine, against a
local PostgreSQL 18.4 instance via `DATABASE_URL` (the same instance the
compatibility verification used) — not CI hardware, not representative of
production performance. All six benchmarks ran cleanly with the isolated
scratch-database bootstrap; no orphaned databases remained afterward. See
[baselines/outbox/](baselines/outbox/) for the raw JSON.

| Benchmark                            | Mean   | p50    | p95    |
| ------------------------------------ | ------ | ------ | ------ |
| `write-outbox-events-batch-10`       | 4.24ms | 3.39ms | 7.68ms |
| `relay-poll-once-batch-10`           | 4.80ms | 3.80ms | 8.43ms |
| `relay-dispatch-batch-10-in-memory`  | 0.95ms | 0.29ms | 3.12ms |
| `checkpoint-advance`                 | 1.66ms | 1.11ms | 5.34ms |
| `processed-event-mark`               | 1.39ms | 1.12ms | 3.08ms |
| `partition-maintenance-steady-state` | 3.56ms | 2.72ms | 8.45ms |

The gap between `relay-poll-once-batch-10` (real Postgres, ~4.8ms mean)
and `relay-dispatch-batch-10-in-memory` (~0.95ms mean) is almost entirely
Postgres round-trip cost, not relay-loop overhead — consistent with the
methodology's stated reason for keeping these as two separate benchmarks.

**This first run also caught a real bug**, worth recording here since it
is the kind of thing a baseline run is supposed to catch: the first
attempt to run `relay-dispatch.bench.ts` hung indefinitely. Its in-memory
`OutboxRelayStore` fake computed the next fetch position as
`events.findIndex(e => e.occurredAt > after.occurredAt) + 1` — correct
when the cursor isn't at the last element, but when it _is_ (which is
every round in this benchmark), `findIndex` returns `-1`, and `-1 + 1`
silently wrapped back to index `0` instead of "past the end." `OutboxRelay`
kept receiving the same full batch back forever, matching its "batch was
full, more may be waiting" continuation condition on every round. Fixed
by finding the cursor's own event and starting after it, defaulting to
"nothing left" when not found rather than to `0`. This bug was entirely
confined to the benchmark's own test fixture — no production code was
affected — but it is exactly the kind of off-by-one a real execution
catches that a typecheck/lint pass cannot.

A meaningful cross-environment baseline (CI runners, representative
production hardware) is exactly what E04-T13 should establish; this one
exists to prove the scaffolding works and to give a future optimization
pass a same-machine number to compare against.
