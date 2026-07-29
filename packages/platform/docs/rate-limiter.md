# Component Spec — Postgres Rate Limiter

- **Task:** E03-T41 · **Status:** Implemented · **Category:** ADP (Postgres adapter for the kernel's E02-T08 port)
- **ADR references:** ADR-0004 (Postgres behind ports), ADR-0010 (`./postgres` subpath)
- **Design docs:** [Database §3](../../docs/architecture/DATABASE.md) (`platform.rate_limits` exact schema)

## Contract

**Purpose:** implement the kernel's `RateLimiter` port
(`packages/kernel/src/rate-limiter.ts`) against `platform.rate_limits` —
the same fixed-window semantics `InMemoryRateLimiter` already provides,
durable and correct under concurrent callers.

**Public surface:**

| Export                   | Layer                        | Purpose                                                                |
| ------------------------ | ---------------------------- | ---------------------------------------------------------------------- |
| `ensureRateLimitsSchema` | infrastructure, `./postgres` | Idempotent bootstrap for `platform.rate_limits`                        |
| `PostgresRateLimiter`    | infrastructure, `./postgres` | Implements `RateLimiter`; single atomic UPSERT per `consume()` call    |
| `pruneRateLimitWindows`  | infrastructure, `./postgres` | Explicit maintenance: deletes rows older than a caller-supplied cutoff |

## The atomic UPSERT

`consume()` is one statement, never a read-then-write pair:

```sql
INSERT INTO platform.rate_limits (bucket, window_start, count)
SELECT $bucket, $windowStart, $cost
WHERE $cost <= $limit
ON CONFLICT (bucket, window_start) DO UPDATE
  SET count = platform.rate_limits.count + $cost
  WHERE platform.rate_limits.count + $cost <= $limit
RETURNING count
```

`RETURNING count` yields a row exactly when the request was allowed
(whether this was the bucket's first request in the window, via the
`INSERT ... SELECT ... WHERE` guard, or a subsequent one, via the
`ON CONFLICT ... DO UPDATE ... WHERE` guard) and yields **zero rows**
when denied — in both the "already at the limit" case and the "this
single request's cost alone exceeds the limit, on a brand-new bucket"
case. A denied attempt never mutates the stored row: the `WHERE` clause
on each branch means the conflicting row is left completely untouched
when it fires, not decremented back afterward.

This single-statement design is what makes concurrent correctness
possible: two callers racing to consume the last unit of a bucket's quota
serialize through Postgres's own row-level lock on the `(bucket,
window_start)` primary key — there is no window between a read and a
write for a second caller to land in. Verified directly: 20 concurrent
`consume()` calls against a limit of 10 produce exactly 10 allowed and 10
denied decisions, and the stored count never exceeds 10.

## Finding: untyped bind parameters compare as `text`, not numerically

While building the UPSERT above, an early version omitted the `::integer`
casts on `$cost` and `$limit`. Verified empirically against PostgreSQL 18:
`SELECT ($cost <= $limit)` with `cost = 10, limit = 5` evaluated to
**`true`** — because with no column or other type context to infer from,
Postgres defaulted both parameters to `text`, and `'10' <= '5'` is true
lexicographically (`'1' < '5'`). This silently let an over-limit request
through on a fresh bucket (a single request with `cost = 10` against
`limit = 5` was wrongly allowed, seeding a `count = 10` row). Every
numeric comparison in the final query is explicitly cast to `::integer`
to remove the ambiguity — this is not a defensive habit, it's the fix for
a real bug this component would otherwise have shipped. The regression is
covered directly by a test using `cost = 9, limit = 10` (numerically
allowed, lexicographically would be denied since `'9' > '10'` as
strings).

## Window pruning

`platform.rate_limits` has no `window_end` column (DB §3's schema is
exactly `bucket`, `window_start`, `count`) — a window's expiry isn't
self-describing from the row alone, since different buckets may use
different `policy.windowMs` values. `pruneRateLimitWindows(sql,
olderThan)` is an explicit, separately-scheduled maintenance operation
(matching E03-T03's posture toward outbox partition maintenance): the
caller supplies the cutoff, informed by the largest `windowMs` in use
across every policy the deployment configures.

## Failure modes

| Failure                                                    | Behavior                                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consume()` called with `cost` that alone exceeds `limit`  | Denied; no row is seeded for a fresh bucket, and an existing bucket's stored count is left untouched                                                                        |
| Two callers race the same bucket near its limit boundary   | Exactly as many are allowed as remaining quota permits; the rest are denied — proven directly, not assumed                                                                  |
| `pruneRateLimitWindows` called with a cutoff in the future | Deletes every row (every window is "older" than a future cutoff) — the caller's responsibility to pass a sane cutoff, same as any DELETE-by-predicate maintenance operation |

## Retry / timeout / cancellation

None at this layer — one atomic statement per `consume()` call, matching
this package's posture toward every other single-operation adapter (no
built-in retry loop).

## Concurrency guarantees

Postgres's row-level lock on the `(bucket, window_start)` primary key
serializes concurrent `consume()` calls against the same bucket+window —
proven directly with 20 concurrent callers against a limit of 10.
Different buckets (or the same bucket in different windows) never
contend with each other at all.

## Performance

One UPSERT per `consume()` call on the allowed path; one UPSERT plus one
follow-up `SELECT` on the denied path (needed only to report `remaining`
accurately, since the UPSERT itself returns no row to read that from).
Not formally benchmarked (pending E04-T13, same posture as every other
platform component).

## Security considerations

`bucket` is application-supplied (e.g. `login:ip:1.2.3.4`) and passed
directly as a bind parameter — no string interpolation, no injection
surface. Same trust boundary as every other adapter in this package:
callers are trusted application code choosing their own bucket-naming
scheme (kernel's own port doc already documents this).

## Observability

None added directly — matches this package's posture toward every other
adapter with no branching worth instrumenting beyond what
`RateLimitDecision`'s own fields already expose to the caller.

## Testing

**8 real-Postgres integration tests**
(`test/integration/rate-limiter.postgres.test.ts`). Since E04-T01, the first
5 come from `@corestack/kernel/testing`'s shared `RateLimiter` contract
suite (`defineRateLimiterContractSuite`) run directly against this adapter
— allow-up-to-limit-then-deny with a positive `retryAfterMs`, epoch-aligned
window reset, multi-unit cost accounting, bucket independence, and
cost-exceeds-limit denial — proving this adapter satisfies the identical
behavioral contract kernel's own `InMemoryRateLimiter` proves, without
hand-mirroring the test bodies (see
[kernel's contract-suite-framework.md](../../kernel/docs/contract-suite-framework.md)).
The 3 remaining tests are Postgres-specific, outside the portable contract:
a request whose cost alone exceeds the limit never seeds a row for a fresh
bucket (also the regression case for the lexicographic-comparison bug,
`cost = 9, limit = 10` allowed numerically); concurrent correctness (20
racing callers, limit 10, exactly 10/10 split, stored count never exceeds
10); and `pruneRateLimitWindows` deleting only rows older than its cutoff.

## Design rationale

Why a single UPSERT instead of `SELECT ... FOR UPDATE` followed by an
application-level check-then-write? A `SELECT ... FOR UPDATE` transaction
would work but requires the caller to open and manage a transaction
around every `consume()` call — an UPSERT with a `WHERE` guard on both the
insert and conflict-update branches gets the same atomicity in one
statement, on the bare connection pool, with no transaction management
the caller needs to think about.

Why does a denied request trigger a second `SELECT` rather than making
the first UPSERT always return a row (allowed or not)? `RETURNING` only
ever reflects rows the statement actually touched — an UPSERT whose
`WHERE` guard fired touches nothing, so there is no row for `RETURNING`
to hand back. The alternative (unconditionally upserting, then checking
the returned count against the limit in application code and rolling
back the increment if it's over) reintroduces exactly the read-then-write
race this design exists to avoid. Accepting a second query only on the
less-common denied path is the correct trade, not a compromise.
