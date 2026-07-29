/**
 * Shared measurement harness for the outbox benchmark scripts (E03
 * Infrastructure Consolidation, section 3). Deliberately not vitest's own
 * `bench()` API: these files run as plain `it()` blocks, picked up only by
 * `vitest.bench.config.ts`'s dedicated `include` pattern via the `bench`
 * npm script — the default `test`/`test:integration` scripts use their
 * own configs and never match `*.bench.ts`, so benchmarks can never
 * silently ride along in the CI-gated suites (see the methodology doc for
 * why that separation matters).
 *
 * No thresholds, no pass/fail assertions on timing — this scaffolding
 * exists to produce a comparable baseline, not to gate CI. Threshold
 * enforcement is explicitly out of scope until E04-T13.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface BenchStats {
  readonly name: string;
  readonly iterations: number;
  readonly meanMs: number;
  /** `1000 / meanMs` — a single-call throughput estimate, meaningful only for benchmarks measuring one logical operation per timed call (not e.g. a fixed-size batch). */
  readonly opsPerSecond: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly recordedAt: string;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

/**
 * Runs `fn` `iterations` times (after `warmup` untimed runs) and returns
 * timing stats. `setup`, when given, runs immediately before each timed
 * (and warmup) call and is excluded from the measured duration — for
 * benchmarks that need fresh per-iteration state (e.g. a new batch of
 * events to poll) without timing the setup itself.
 */
export async function measure(
  name: string,
  fn: () => Promise<void>,
  options: {
    readonly iterations?: number;
    readonly warmup?: number;
    readonly setup?: () => Promise<void>;
  } = {},
): Promise<BenchStats> {
  const iterations = options.iterations ?? 50;
  const warmup = options.warmup ?? 5;

  for (let i = 0; i < warmup; i++) {
    await options.setup?.();
    await fn();
  }

  const timings: number[] = [];
  for (let i = 0; i < iterations; i++) {
    await options.setup?.();
    const start = performance.now();
    await fn();
    timings.push(performance.now() - start);
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const meanMs = timings.reduce((a, b) => a + b, 0) / timings.length;
  return {
    name,
    iterations,
    meanMs,
    opsPerSecond: 1000 / meanMs,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    recordedAt: new Date().toISOString(),
  };
}

const OUTBOX_BASELINE_DIR = fileURLToPath(
  new URL("../../../docs/quality/architecture-benchmarks/baselines/outbox/", import.meta.url),
);

/**
 * Writes one benchmark's result as the current baseline and prints a
 * one-line summary. `dir` defaults to the outbox subsystem's existing
 * baseline location for backward compatibility with the E03
 * Infrastructure Consolidation benchmarks; pass an absolute path (e.g.
 * `docs/quality/performance/`) for benchmarks outside that subsystem —
 * see the contract-suite adapter benchmarks (E04) for an example.
 */
export function writeBaseline(stats: BenchStats, dir: string = OUTBOX_BASELINE_DIR): void {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${stats.name}.json`);
  writeFileSync(path, `${JSON.stringify(stats, null, 2)}\n`);
  console.log(
    `[bench] ${stats.name}: mean=${stats.meanMs.toFixed(2)}ms p50=${stats.p50Ms.toFixed(2)}ms ` +
      `p95=${stats.p95Ms.toFixed(2)}ms p99=${stats.p99Ms.toFixed(2)}ms min=${stats.minMs.toFixed(2)}ms ` +
      `max=${stats.maxMs.toFixed(2)}ms (n=${stats.iterations}) -> ${path}`,
  );
}

/** Absolute path to `docs/quality/performance/` for the E04 contract-suite adapter benchmarks. */
export const PERFORMANCE_BASELINE_DIR = fileURLToPath(
  new URL("../../../docs/quality/performance/", import.meta.url),
);
