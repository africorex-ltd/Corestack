# ADR 0019: `IdempotencyStore` added to the kernel (E03-T43 prerequisite)

- **Status:** Accepted
- **Date:** 2026-07-29
- **Elaborated in:** [Architecture §26](../architecture/ARCHITECTURE.md), [Database §3](../architecture/DATABASE.md) (`platform.idempotency_keys`)

## Context

E03-T43 ("Idempotency-key store adapter — `platform.idempotency_keys`
semantics: in-progress lock, replay, body-hash conflict") is categorized
`ADP` (adapter) in the blueprint, the same category as E03-T41's
`PostgresRateLimiter` — implying a kernel port already exists for it to
adapt. It doesn't: grepping `packages/kernel/src` for `Idempotency` before
this task found nothing, and no E02 task ever defines one (unlike `Cache`
and `RateLimiter`, which E02-T07/T08 shipped ahead of their E03-T42/T41
Postgres adapters).

The blueprint itself assumes the port exists at kernel level: E04-T03
("Port contract suites for kernel ports") lists `IdempotencyStore` in the
same enumeration as `EventBus`, `Cache`, `RateLimiter`, `Encrypter`,
`UnitOfWork` — all five of which are kernel ports today, each with an
in-memory reference implementation. This is the discriminating fact: the
approved plan already treats `IdempotencyStore` as a kernel-port sibling of
those five, not as a platform-only concept. The missing E02 row is a
blueprint gap, not evidence that the port belongs elsewhere.

## Decision

Add `IdempotencyStore` to the kernel (`packages/kernel/src/idempotency-store.ts`),
matching the E02-T07/T08 shape: a port interface plus an in-memory
reference adapter (`InMemoryIdempotencyStore`), exported from the kernel's
public surface (snapshot-gated in `test/api-surface.test.ts`). This is
additive-only — no existing kernel export changes — so it does not trigger
Platform Maturity Mode's "every kernel change must justify why it can't be
an adapter/module/extension instead": a port _is_ the thing that belongs in
the kernel, by the same reasoning that put `Cache` and `RateLimiter` there.

**Port shape — a begin/complete lifecycle, not a key-value cache.** The
acceptance criterion ("concurrent same-key second caller blocks/conflicts
correctly") and DB §3's `status CHECK (in_progress|completed)` column both
say this isn't a `get`/`set` pair:

- `begin(scope, key, requestHash, ttlMs)` classifies `(scope, key)` and, on
  a fresh or expired entry, atomically acquires the lock in the same call —
  returning `started`, `replay` (with the stored response), `inProgress`,
  or `conflict` (different `requestHash` for the same key).
- `complete(scope, key, requestHash, response, ttlMs)` records the outcome
  for future replay; it is a no-op if the lock is no longer `in_progress`
  with the matching `requestHash` (already completed, or expired and
  reclaimed by a newer attempt) — never a clobber of newer state.
- `ttlMs` on both calls bounds expiry: an abandoned `in_progress` lock
  (caller crashed before calling `complete`) becomes reclaimable, and a
  `completed` entry stops being replayable, once its `ttlMs` elapses.

`PostgresIdempotencyStore` (E03-T43, `./postgres`) implements this port
against `platform.idempotency_keys` exactly per DB §3's schema.

## Alternatives considered

- **Define the port in `platform`'s application layer instead** (the shape
  T30/T31/T33 used for `OrgScopedContext`/`PurgeHandler`): rejected —
  those are Postgres/RLS-specific narrowings and event-dispatch
  compositions, not general-purpose ports with a planned second
  implementation. `IdempotencyStore` has exactly the same shape as `Cache`
  and `RateLimiter` (a port + in-memory reference + a durable adapter to
  follow), and E04-T03.6 already assumes it's a kernel port. Putting it in
  platform "for now" would mean either an unimplementable E04-T03.6 or a
  later migration that changes every consumer's import path — decide it
  once, correctly, now.
- **Model `begin`/`complete` as a plain `get`/`set` cache-like pair**:
  rejected — doesn't express the lock-acquisition atomicity the acceptance
  criterion demands, and can't represent "in progress" as a first-class
  outcome distinct from "not found."

## Consequences

- The kernel's public export surface grows by one port (`IdempotencyStore`,
  `IdempotencyBeginResult`) and one reference adapter
  (`InMemoryIdempotencyStore`) — reflected in the snapshot-gated API test.
- E04-T03.6 (port contract suite for `IdempotencyStore`) now has a real
  port and two real implementations (in-memory, Postgres) to write a
  shared contract suite against, instead of an assumed one.
- Any future adapter for this port (e.g. a Redis-backed one, mirroring the
  `Cache`/`RateLimiter` scale-up story) implements the same kernel
  interface — no redesign needed.
