/**
 * `PostgresIdempotencyStore` — the reference `IdempotencyStore` adapter
 * (E03-T43; DB §3: `platform.idempotency_keys`). Ships under `./postgres`
 * (ADR-0010).
 *
 * `begin` and `complete` are each a single atomic statement — never a
 * read-then-write pair, and each commits on its own rather than being
 * wrapped in the caller's use-case transaction. This matters for
 * concurrency, not just correctness: verified empirically against PG18
 * that a second connection's `INSERT ... ON CONFLICT` on the same
 * `(scope, key)` **blocks** on Postgres's row-level lock until the first
 * connection's statement commits or rolls back — it does not return
 * immediately with zero rows. If `begin()` were nested inside the same
 * transaction as the full use-case's (possibly slow) work, every losing
 * concurrent caller for that key would block for the winner's *entire*
 * request duration before it could even classify as `inProgress`. Because
 * `begin()` is one immediately-committing statement here, that block is
 * bounded by the winner's single INSERT/UPDATE — near-instant.
 *
 * The `begin` UPSERT's `WHERE` guard treats an expired row (whichever
 * status it's in) as absent: `ON CONFLICT ... DO UPDATE ... WHERE
 * expires_at <= $now` overwrites it as a fresh `in_progress` lock,
 * reclaiming a key wedged by a caller that crashed before calling
 * `complete`. `$now` is always the injected `Clock`'s value, never
 * Postgres's own `now()` — a real bug caught empirically while writing
 * this adapter's tests: under a `FixedClock` frozen at a simulated instant,
 * Postgres's real wall-clock `now()` is almost always later than that
 * instant, so comparing `expires_at` against SQL `now()` made the reclaim
 * guard fire unconditionally, even for entries that were "expired" only
 * relative to the simulated clock. Binding the same `Clock` value used to
 * compute `expires_at` keeps both sides of the comparison on one time
 * source. When the guard doesn't fire (a live entry exists), the
 * UPSERT touches nothing and returns zero rows, exactly like T41's
 * `RateLimiter` adapter's denied path — a follow-up `SELECT` (not
 * decision-critical, just for classification) distinguishes `replay`
 * (completed, same `requestHash`), `inProgress` (same `requestHash`, still
 * running), or `conflict` (different `requestHash`).
 *
 * `complete`'s `UPDATE` only transitions a row that is still `in_progress`,
 * with the matching `requestHash`, and not yet expired — a late `complete`
 * call against a lock that already expired and was reclaimed by a newer
 * attempt matches nothing and is a silent no-op, identical to the kernel's
 * `InMemoryIdempotencyStore`.
 *
 * `response_snapshot` is never `JSON.stringify`'d — verified empirically
 * (same finding as E03-T11's outbox writer) that `postgres.js` serializes a
 * raw object into `jsonb` correctly on write and returns a real object (not
 * a string) on read; pre-stringifying would double-encode it. Unlike T11's
 * `sql(rows)` object-insert helper — which has its own typing path that
 * accepts a plain object destined for a `jsonb` column — a raw tagged
 * template parameter's TypeScript types require `sql.json(...)` to accept a
 * plain object at all; both forms serialize identically at runtime
 * (verified directly), the difference is compile-time typing only.
 */
import {
  SystemClock,
  type Clock,
  type IdempotencyBeginResult,
  type IdempotencyStore,
} from "@corestack/kernel";
import type { JSONValue, Sql } from "postgres";

interface IdempotencyRow {
  request_hash: string;
  status: "in_progress" | "completed";
  response_snapshot: unknown;
}

export class PostgresIdempotencyStore implements IdempotencyStore {
  readonly #sql: Sql;
  readonly #clock: Clock;

  constructor(sql: Sql, clock: Clock = new SystemClock()) {
    this.#sql = sql;
    this.#clock = clock;
  }

  async begin(
    scope: string,
    key: string,
    requestHash: string,
    ttlMs: number,
  ): Promise<IdempotencyBeginResult> {
    const now = this.#clock.now();
    const expiresAt = new Date(now.getTime() + ttlMs);

    const rows = await this.#sql<IdempotencyRow[]>`
      INSERT INTO platform.idempotency_keys (scope, key, request_hash, status, response_snapshot, expires_at)
      VALUES (${scope}, ${key}, ${requestHash}, 'in_progress', NULL, ${expiresAt})
      ON CONFLICT (scope, key) DO UPDATE
        SET request_hash = EXCLUDED.request_hash,
            status = 'in_progress',
            response_snapshot = NULL,
            expires_at = EXCLUDED.expires_at
        WHERE platform.idempotency_keys.expires_at <= ${now}
      RETURNING request_hash, status, response_snapshot
    `;

    if (rows.length > 0) {
      return { outcome: "started" };
    }

    const existing = await this.#sql<IdempotencyRow[]>`
      SELECT request_hash, status, response_snapshot
      FROM platform.idempotency_keys
      WHERE scope = ${scope} AND key = ${key}
    `;
    const row = existing[0];
    if (row === undefined) {
      // Extremely narrow race: the live row we just lost to was itself
      // pruned between the UPSERT and this SELECT. Safe to treat as fresh.
      return { outcome: "started" };
    }

    if (row.request_hash !== requestHash) {
      return { outcome: "conflict" };
    }

    if (row.status === "completed") {
      return { outcome: "replay", response: row.response_snapshot };
    }

    return { outcome: "inProgress" };
  }

  async complete(
    scope: string,
    key: string,
    requestHash: string,
    response: unknown,
    ttlMs: number,
  ): Promise<void> {
    const now = this.#clock.now();
    const expiresAt = new Date(now.getTime() + ttlMs);

    await this.#sql`
      UPDATE platform.idempotency_keys
      SET status = 'completed', response_snapshot = ${this.#sql.json(response as JSONValue)}, expires_at = ${expiresAt}
      WHERE scope = ${scope} AND key = ${key}
        AND status = 'in_progress' AND request_hash = ${requestHash} AND expires_at > ${now}
    `;
  }
}

/**
 * Explicit maintenance operation — not run automatically — matching T41's
 * `pruneRateLimitWindows` posture. Unlike `platform.rate_limits` (no
 * self-describing expiry column), `idempotency_keys.expires_at` IS the
 * expiry, so pruning is simply "delete anything already expired as of the
 * caller-supplied instant" rather than a derived cutoff.
 */
export async function pruneIdempotencyKeys(sql: Sql, olderThan: Date): Promise<number> {
  const result = await sql`DELETE FROM platform.idempotency_keys WHERE expires_at < ${olderThan}`;
  return result.count;
}
