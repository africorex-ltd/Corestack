/**
 * `PostgresRateLimiter` — the reference `RateLimiter` adapter (E03-T41;
 * DB §3: fixed-window counters on `platform.rate_limits`). Ships under
 * `./postgres` (ADR-0010).
 *
 * Windowing matches kernel's `InMemoryRateLimiter` exactly: fixed windows
 * aligned to epoch multiples of `policy.windowMs`
 * (`windowStart = now - (now % windowMs)`), so a caller sees identical
 * window-boundary behavior regardless of which adapter is wired in.
 *
 * `consume` is a single atomic UPSERT — never a read-then-write pair —
 * so concurrent callers racing to consume the same bucket's remaining
 * quota can never jointly over-consume it (verified against PG18 with 20
 * concurrent callers against a limit of 10: exactly 10 allowed, 10
 * denied, final stored count never exceeds the limit). `ON CONFLICT ...
 * DO UPDATE ... WHERE` skips the update entirely (leaving the stored
 * count untouched) when applying this call's cost would exceed the
 * limit; `INSERT ... SELECT ... WHERE` applies the identical guard to a
 * bucket's very first request in a window, so a single over-limit
 * request against a fresh bucket is correctly denied rather than
 * silently seeding an over-limit row.
 *
 * Every numeric comparison in the UPSERT is explicitly cast (`::integer`)
 * — verified empirically that without the cast, Postgres compares
 * bind-parameter values with no other type context as `text`, which
 * evaluates `10 <= 5` as `true` (lexicographic string comparison: `"1" <
 * "5"`). This is silent and would have shipped a real over-limit-allowed
 * bug; every comparison here is cast to remove the ambiguity rather than
 * relying on inference from the table's own `integer` column type, since
 * the `INSERT ... SELECT` branch has no column context to infer from at
 * all.
 */
import {
  SystemClock,
  type Clock,
  type RateLimitDecision,
  type RateLimitPolicy,
  type RateLimiter,
} from "@corestack/kernel";
import type { Sql } from "postgres";

export class PostgresRateLimiter implements RateLimiter {
  readonly #sql: Sql;
  readonly #clock: Clock;

  constructor(sql: Sql, clock: Clock = new SystemClock()) {
    this.#sql = sql;
    this.#clock = clock;
  }

  async consume(bucket: string, policy: RateLimitPolicy, cost = 1): Promise<RateLimitDecision> {
    const now = this.#clock.now().getTime();
    const windowStart = now - (now % policy.windowMs);
    const windowEnd = windowStart + policy.windowMs;
    const windowStartDate = new Date(windowStart);

    const rows = await this.#sql<{ count: number }[]>`
      INSERT INTO platform.rate_limits (bucket, window_start, count)
      SELECT ${bucket}, ${windowStartDate}::timestamptz, ${cost}::integer
      WHERE ${cost}::integer <= ${policy.limit}::integer
      ON CONFLICT (bucket, window_start) DO UPDATE
        SET count = platform.rate_limits.count + ${cost}::integer
        WHERE platform.rate_limits.count + ${cost}::integer <= ${policy.limit}::integer
      RETURNING count
    `;

    if (rows.length > 0) {
      const count = rows[0]!.count;
      return {
        allowed: true,
        limit: policy.limit,
        remaining: policy.limit - count,
        retryAfterMs: null,
      };
    }

    const existing = await this.#sql<{ count: number }[]>`
      SELECT count FROM platform.rate_limits
      WHERE bucket = ${bucket} AND window_start = ${windowStartDate}::timestamptz
    `;
    const existingCount = existing[0]?.count ?? 0;

    return {
      allowed: false,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - existingCount),
      retryAfterMs: windowEnd - now,
    };
  }
}

/**
 * Explicit maintenance operation — not run automatically by `consume` —
 * matching E03-T03's posture toward outbox partition maintenance
 * (a scheduled job, not implicit per-call work). `platform.rate_limits`
 * has no `window_end` column (DB §3's schema is exactly `bucket`,
 * `window_start`, `count`), so pruning is by a caller-supplied cutoff
 * rather than a self-describing expiry: the caller knows the largest
 * `windowMs` in use across every policy and picks `olderThan`
 * accordingly (e.g. `now - largestWindowMs`).
 */
export async function pruneRateLimitWindows(sql: Sql, olderThan: Date): Promise<number> {
  const result = await sql`DELETE FROM platform.rate_limits WHERE window_start < ${olderThan}`;
  return result.count;
}
