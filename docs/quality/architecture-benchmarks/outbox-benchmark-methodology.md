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

| Script                             | Measures                                                                                                                                           | Backing                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `write-outbox-events.bench.ts`     | `writeOutboxEvents(sql, events)` inserting a 10-event batch                                                                                        | Real Postgres (Testcontainers) |
| `relay-polling.bench.ts`           | One full `OutboxRelay.pollOnce()` round (checkpoint read, fetch, no-op dispatch, checkpoint advance) against a fresh 10-event batch each iteration | Real Postgres (Testcontainers) |
| `relay-dispatch.bench.ts`          | The relay's own dispatch-loop overhead in isolation, backed by an in-memory fake store — separates relay logic cost from Postgres I/O cost         | In-memory (no Testcontainers)  |
| `checkpoint-updates.bench.ts`      | `PostgresOutboxRelayStore.advanceCheckpoint`                                                                                                       | Real Postgres (Testcontainers) |
| `processed-event-inserts.bench.ts` | `PostgresProcessedEventStore.markProcessed` (fresh event id each call, never the `ON CONFLICT` path)                                               | Real Postgres (Testcontainers) |
| `partition-maintenance.bench.ts`   | `maintainOutboxPartitions`'s steady-state create-ahead path (partitions already exist, call is a `pg_inherits` read plus idempotent no-op DDL)     | Real Postgres (Testcontainers) |

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

1. Boots a fresh `postgres:16-alpine` Testcontainer (except
   `relay-dispatch`, which needs no database).
2. Bootstraps the outbox schema fresh per benchmark file
   (`ensureOutboxSchema`).
3. Runs 5 (200 for `relay-dispatch`, which is cheap and in-memory) untimed
   warmup iterations to let JIT/connection-pool warm-up settle before
   measurement starts.
4. Runs 50 (200 for `relay-dispatch`) timed iterations, recording
   wall-clock duration per iteration via `performance.now()`.
5. Computes mean, p50, p95, min, and max across the timed iterations.
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
- **No file-parallelism:** all five Postgres-backed benchmarks run via
  `--no-file-parallelism` in the `bench` npm script, for the same reason
  the `test:integration` script does — this machine's local Testcontainers
  setup has a real memory ceiling (documented in project memory), and
  running multiple Postgres containers concurrently causes intermittent
  Docker API failures. This is a local-sandbox accommodation, not a
  statement about CI capacity.

## How to run

```bash
pnpm --filter @corestack/platform bench
```

Requires a working Docker daemon (same requirement as
`test:integration`). Each of the five Postgres-backed scripts starts and
tears down its own container sequentially; expect this to take noticeably
longer than the test suites.

## Baseline provenance

**No baseline has been captured yet.** The six scripts above are verified
to typecheck (`tsc --noEmit`, `bench` added to `tsconfig.json`'s
`include`) and lint clean, but have never actually executed end-to-end:
this local development machine's Docker Desktop installation became
unavailable (installation directory left in a `tmp-delete` state, no
`docker` binary, no Docker service running) while the first run was
in progress, and the run had to be abandoned rather than reported as
successful. `docs/quality/architecture-benchmarks/baselines/outbox/`
does not exist yet — it is created on first successful run, per
`bench/harness.ts`'s `writeBaseline`.

**Once Docker Desktop is restored on this machine**, run:

```bash
pnpm --filter @corestack/platform bench
```

and this section should be updated with the actual date, machine, and a
link to the generated baseline files — not before. A meaningful
cross-environment baseline (CI runners, representative production
hardware) is exactly what E04-T13 should establish regardless.
