# Component Spec — Postgres Idempotency-Key Store

- **Task:** E03-T43 · **Status:** Implemented · **Category:** ADP (Postgres
  adapter for the kernel's `IdempotencyStore` port)
- **ADR references:** ADR-0004 (Postgres behind ports), ADR-0010
  (`./postgres` subpath), ADR-0019 (`IdempotencyStore` added to the kernel —
  a prerequisite this task needed and the blueprint's own E04-T03 already
  assumed existed)
- **Design docs:** [Architecture §26](../../docs/architecture/ARCHITECTURE.md)
  (request-level idempotency for mutating REST endpoints), [Database §3](../../docs/architecture/DATABASE.md)
  (`platform.idempotency_keys` exact schema)

## Contract

**Purpose:** implement the kernel's `IdempotencyStore` port
(`packages/kernel/src/idempotency-store.ts`) against
`platform.idempotency_keys` — a begin/complete lifecycle for
`Idempotency-Key`-bearing mutating requests: acquire a lock for a genuinely
new attempt, replay a completed attempt's stored response unchanged, and
reject a same-key request whose body hash differs (conflict) or whose twin
is still running (in progress).

**Public surface:**

| Export                        | Layer                        | Purpose                                                                  |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `ensureIdempotencyKeysSchema` | infrastructure, `./postgres` | Idempotent bootstrap for `platform.idempotency_keys`                     |
| `PostgresIdempotencyStore`    | infrastructure, `./postgres` | Implements `IdempotencyStore`; `begin`/`complete` are each one statement |
| `pruneIdempotencyKeys`        | infrastructure, `./postgres` | Explicit maintenance: deletes rows already expired as of a given instant |

## The begin/complete lifecycle

`begin(scope, key, requestHash, ttlMs)` is a single UPSERT — never a
read-then-write pair:

```sql
INSERT INTO platform.idempotency_keys (scope, key, request_hash, status, response_snapshot, expires_at)
VALUES ($scope, $key, $requestHash, 'in_progress', NULL, $expiresAt)
ON CONFLICT (scope, key) DO UPDATE
  SET request_hash = EXCLUDED.request_hash,
      status = 'in_progress',
      response_snapshot = NULL,
      expires_at = EXCLUDED.expires_at
  WHERE platform.idempotency_keys.expires_at <= $now
RETURNING request_hash, status, response_snapshot
```

A row is returned exactly when this call acquired the lock — either no
entry existed for `(scope, key)`, or the existing one had already expired
(whichever status it was in) and this call reclaimed it as a fresh
`in_progress` lock. Zero rows means a live entry already exists; a
follow-up `SELECT` (not decision-critical, purely for classification)
distinguishes the three losing outcomes: `conflict` (different
`requestHash`), `replay` (completed, same `requestHash` — returns the
stored `response_snapshot`), or `inProgress` (same `requestHash`, still
running).

`complete(scope, key, requestHash, response, ttlMs)` is a single guarded
`UPDATE`:

```sql
UPDATE platform.idempotency_keys
SET status = 'completed', response_snapshot = $response, expires_at = $newExpiresAt
WHERE scope = $scope AND key = $key
  AND status = 'in_progress' AND request_hash = $requestHash AND expires_at > $now
```

If the lock is no longer `in_progress` with this exact `requestHash` and
not yet expired — already completed, or expired and reclaimed by a newer
attempt — the `WHERE` clause matches nothing and the call is a silent
no-op, identical to the kernel's `InMemoryIdempotencyStore`.

## Two real findings caught before shipping

**Finding 1 — `begin`/`complete` must never be nested in the caller's
use-case transaction.** Verified empirically against PG18 with two real
connections: a second connection's `INSERT ... ON CONFLICT` on the same
`(scope, key)` **blocks** on Postgres's row-level lock until the first
connection's statement commits or rolls back — it does not return
immediately with zero rows. Had `begin()` been wrapped in the same
transaction as the full use-case's (possibly slow) work, every losing
concurrent caller for that key would block for the _winner's entire
request duration_ just to find out it should return `inProgress`. Because
`begin()` here is one immediately-committing statement, decoupled from
whatever the caller does between `begin()` and `complete()`, that block is
bounded by the winner's single INSERT/UPDATE — near-instant. This is the
same reasoning T40's `PostgresUnitOfWork` spec documents for why
`withOrgContext`/`runOrgScopedQuery` can't nest inside `UnitOfWork.run()`;
here it cuts the other way — this store must run _outside_ any transaction
the caller holds open, precisely so it doesn't inherit that transaction's
duration.

**Finding 2 — expiry comparisons must use the injected `Clock`, never SQL
`now()`.** An early version compared `expires_at` against Postgres's own
`now()` in both `begin`'s `WHERE` guard and `complete`'s `WHERE` clause.
Under a `FixedClock` frozen at a simulated instant (used throughout this
package's tests for determinism), Postgres's real wall-clock `now()` is
almost always later than that simulated instant — so `expires_at <=
now()` was true unconditionally, and every test expecting `inProgress` or
`replay` instead saw `started`: the guard reclaimed a lock that hadn't
actually expired relative to the clock the test controlled. Caught
immediately by the integration suite (4 of 9 tests failed on first run).
Fixed by binding `this.#clock.now()` as an explicit parameter on both
sides of every expiry comparison, so `expires_at` and the comparison
instant always come from the same time source — whichever `Clock` the
caller injects.

## Failure modes

| Failure                                                              | Behavior                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Two callers race `begin()` for the same key, same `requestHash`      | Exactly one sees `started`; the rest see `inProgress` — proven directly with genuinely separate connections and with 20 concurrent callers |
| Two callers race `begin()` for the same key, different `requestHash` | Whichever loses the race sees `conflict`, never `inProgress` or `started`                                                                  |
| Caller crashes after `started`, before `complete()`                  | The lock is reclaimable once `ttlMs` elapses — the next `begin()` for that key sees `started` again, not permanently wedged                |
| `complete()` called against an already-expired, reclaimed lock       | Silent no-op — never overwrites the newer attempt's state                                                                                  |
| `pruneIdempotencyKeys` called with a cutoff in the future            | Deletes every row (every entry is "expired" relative to a future cutoff) — caller's responsibility, same as `pruneRateLimitWindows`        |

## Retry / timeout / cancellation

None at this layer — `begin`/`complete` are each one atomic statement,
matching this package's posture toward every other single-operation
adapter (no built-in retry loop). A losing concurrent caller's `begin()`
call may block briefly on Postgres's row-level lock (bounded by the
winner's single statement, not the winner's whole request); no explicit
timeout is set beyond the connection's own defaults.

## Concurrency guarantees

Postgres's row-level lock on the `(scope, key)` primary key serializes
concurrent `begin()`/`complete()` calls against the same entry — proven
directly with two genuinely separate connections (not just the same pool)
racing the same key, and with 20 concurrent callers producing exactly one
`started` and nineteen `inProgress`. Different `(scope, key)` pairs never
contend with each other at all.

## Performance

One UPSERT per `begin()` call on the winning path; one UPSERT plus one
follow-up `SELECT` on the losing path (needed only for classification,
mirroring T41's `RateLimiter` denied-path shape). One `UPDATE` per
`complete()` call. Not formally benchmarked (pending E04-T13, same posture
as every other platform component).

## Security considerations

`scope` and `key` are application-supplied (e.g. `scope="orders:create"`,
`key` from the client's `Idempotency-Key` header) and passed directly as
bind parameters — no string interpolation, no injection surface.
`response_snapshot` stores whatever the use case returned for later
replay; callers are responsible for not putting secrets in a response they
intend to be replayable (same trust boundary as any cached response).

## Observability

None added directly — matches this package's posture toward every other
adapter with no branching worth instrumenting beyond what
`IdempotencyBeginResult`'s own discriminated `outcome` field already
exposes to the caller.

## Testing

**9 real-Postgres integration tests**
(`test/integration/idempotency-store.postgres.test.ts`): the happy path
(start → complete → replay with the same body); conflict on a different
body, both while in-progress and after completion; expired-lock reclaim
and expired-completion-no-longer-replayable; `complete()` as a no-op
against an already-reclaimed lock; scope independence; the blueprint's own
acceptance criterion verified with two genuinely separate connections
racing the same key; a 20-concurrent-caller race producing exactly one
`started`; and `pruneIdempotencyKeys` deleting only entries expired as of
a given cutoff. The kernel's own 8 unit tests
(`packages/kernel/test/ports.test.ts`) prove the identical behavioral
contract against `InMemoryIdempotencyStore`.

## Design rationale

Why `begin`/`complete` instead of `get`/`set`? The acceptance criterion —
concurrent same-key callers must classify correctly, not just read a
value — needs lock _acquisition_ to be part of the read, in one atomic
step. A `get` that doesn't also acquire invites the same
check-then-act race this design exists to avoid.

Why does `complete()` take `requestHash` as a parameter, when the caller
already knows it matched during `begin()`? So a stale `complete()` call
(from an attempt whose lock already expired and was reclaimed by someone
else) can be recognized and ignored via a `WHERE` condition, rather than
requiring the caller to track a separate fencing token. This is the same
"documented boundary, not perfect fencing" trade-off as the kernel port's
own TSDoc describes, mirroring `RateLimiter`'s accepted fixed-window
boundary behavior (AUD-07).
