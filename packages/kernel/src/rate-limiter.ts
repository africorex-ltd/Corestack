/**
 * The `RateLimiter` port (Architecture §17 API-doc, §25).
 *
 * Enforced at the use-case layer so limits hold across every transport.
 * Semantics: **fixed window** — `limit` consumptions per `windowMs`, window
 * boundaries aligned to epoch multiples of `windowMs`. Callers own their
 * policy (from validated config) and pass it per call; buckets are opaque
 * strings (`login:ip:1.2.3.4`, `reset:email:<hash>`).
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
  count: number;
}

/** Reference single-node adapter; Postgres/Redis adapters share the contract suite. */
export class InMemoryRateLimiter implements RateLimiter {
  readonly #windows = new Map<string, WindowState>();
  readonly #clock: Clock;

  constructor(options: { clock?: Clock } = {}) {
    this.#clock = options.clock ?? new SystemClock();
  }

  async consume(bucket: string, policy: RateLimitPolicy, cost = 1): Promise<RateLimitDecision> {
    const now = this.#clock.now().getTime();
    const windowStart = now - (now % policy.windowMs);
    const state = this.#windows.get(bucket);

    const current: WindowState =
      state === undefined || state.windowStart !== windowStart ? { windowStart, count: 0 } : state;

    if (current.count + cost > policy.limit) {
      this.#windows.set(bucket, current);
      return {
        allowed: false,
        limit: policy.limit,
        remaining: Math.max(0, policy.limit - current.count),
        retryAfterMs: windowStart + policy.windowMs - now,
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
}
