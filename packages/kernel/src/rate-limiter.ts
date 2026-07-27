/**
 * The `RateLimiter` port (Architecture §17 API-doc, §25).
 *
 * Enforced at the use-case layer so limits hold across every transport.
 * Semantics: **fixed window** — `limit` consumptions per `windowMs`, window
 * boundaries aligned to epoch multiples of `windowMs`. Callers own their
 * policy (from validated config) and pass it per call; buckets are opaque
 * strings (`login:ip:1.2.3.4`, `reset:email:<hash>`).
 *
 * Known property (AUD-07): fixed windows admit up to 2× `limit` across a
 * window boundary. Acceptable for general API limits; auth-critical buckets
 * get a stricter algorithm decision at E06 design time.
 */

import { type Clock, SystemClock } from "./clock.js";

export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  /** Consumptions left in the current window (0 when denied). */
  readonly remaining: number;
  /** Milliseconds until the window resets; null when allowed. */
  readonly retryAfterMs: number | null;
}

export interface RateLimiter {
  consume(bucket: string, policy: RateLimitPolicy, cost?: number): Promise<RateLimitDecision>;
}

interface WindowState {
  windowStart: number;
  windowEnd: number;
  count: number;
}

export interface InMemoryRateLimiterOptions {
  readonly clock?: Clock;
  /**
   * Bucket-map bound (AUD-05): bucket names are attacker-influencable
   * (IPs, emails), so the map must not grow without limit. Expired windows
   * are pruned opportunistically; if still over the cap, oldest entries are
   * evicted (documented trade-off: an evicted live bucket restarts its
   * window — bounded memory beats unbounded precision here).
   */
  readonly maxBuckets?: number;
}

/** Reference single-node adapter; Postgres/Redis adapters share the contract suite. */
export class InMemoryRateLimiter implements RateLimiter {
  readonly #windows = new Map<string, WindowState>();
  readonly #clock: Clock;
  readonly #maxBuckets: number;

  constructor(options: InMemoryRateLimiterOptions = {}) {
    this.#clock = options.clock ?? new SystemClock();
    this.#maxBuckets = options.maxBuckets ?? 10_000;
  }

  /** Current bucket-map size (observability/tests). */
  get bucketCount(): number {
    return this.#windows.size;
  }

  async consume(bucket: string, policy: RateLimitPolicy, cost = 1): Promise<RateLimitDecision> {
    const now = this.#clock.now().getTime();
    if (this.#windows.size >= this.#maxBuckets) {
      this.#prune(now);
    }

    const windowStart = now - (now % policy.windowMs);
    const state = this.#windows.get(bucket);
    const current: WindowState =
      state === undefined || state.windowStart !== windowStart
        ? { windowStart, windowEnd: windowStart + policy.windowMs, count: 0 }
        : state;

    if (current.count + cost > policy.limit) {
      this.#windows.set(bucket, current);
      return {
        allowed: false,
        limit: policy.limit,
        remaining: Math.max(0, policy.limit - current.count),
        retryAfterMs: current.windowEnd - now,
      };
    }

    current.count += cost;
    this.#windows.set(bucket, current);
    return {
      allowed: true,
      limit: policy.limit,
      remaining: policy.limit - current.count,
      retryAfterMs: null,
    };
  }

  #prune(now: number): void {
    for (const [bucket, state] of this.#windows) {
      if (state.windowEnd <= now) this.#windows.delete(bucket);
    }
    // Still over cap (all windows live): evict oldest-inserted until bounded.
    if (this.#windows.size >= this.#maxBuckets) {
      const excess = this.#windows.size - this.#maxBuckets + 1;
      let evicted = 0;
      for (const bucket of this.#windows.keys()) {
        this.#windows.delete(bucket);
        if (++evicted >= excess) break;
      }
    }
  }
}
