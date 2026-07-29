# ADR 0018: No Postgres-backed cache; Redis `CachePort` adapter deferred

- **Status:** Accepted
- **Date:** 2026-07-29
- **Elaborated in:** [Architecture §12](../architecture/ARCHITECTURE.md), [Database §3](../architecture/DATABASE.md)
- **Supersedes/relates to:** ADR-0011 (same deferral shape: reference adapter
  ships now, scale-up adapter ships when a real consumer needs it)

## Context

E03-T42 asks for "Postgres `CachePort` decision note + in-memory/Redis
adapters." Two things are already true before any new code is written:

- E02-T07 already shipped the `Cache` port, `versionedKey`, and the
  `InMemoryLruCache` reference adapter in the kernel
  (`packages/kernel/src/cache.ts`), with tests. There is no second
  in-memory adapter to build.
- `Database §3`'s schema listing has no cache table — `module_migrations`,
  `outbox`, `outbox_checkpoints`, `processed_events`, `idempotency_keys`,
  `rate_limits` are the platform's Postgres-backed primitives. Postgres was
  never in the running as a cache backend; the row's "Postgres" qualifies
  the _decision_, not a table to build.

What remains from the T42 row is the Redis adapter, and this ADR is the
decision note explaining why it isn't shipping now.

## Decision

1. **No Postgres-backed `Cache` adapter.** Architecture §12 already states
   the default is no cache at all; caching is opt-in per module feature via
   the kernel's `Cache` port. A cache backed by the same database it's
   meant to take read pressure off, with extra bookkeeping (TTL sweep,
   version-key growth) and no throughput benefit over reading the
   already-hot table directly, has no justification. Where a module wants
   caching, it uses `InMemoryLruCache` (single-node) today.
2. **The Redis `CachePort` adapter is deferred**, for two concrete reasons,
   not preference:
   - **No Redis client dependency is approved.** Unlike Drizzle (ADR-0004,
     confirmed for the first persistence adapter — see ADR-0017), no ADR
     has pre-approved `ioredis` or `redis` as a dependency. Adding one to
     build an adapter with no current caller is exactly the "unused
     flexibility is a liability" pattern ADR-0017 already rejected for
     Drizzle.
   - **It cannot be verified on this machine.** The T42 acceptance
     criterion is "Both pass cache contract suite; Redis via
     Testcontainers." Docker is unavailable in this dev environment
     (`docker info` fails), and unlike the Postgres integration suite —
     which has a `DATABASE_URL`-based local fallback alongside
     Testcontainers (see `test-support/test-database.ts`) — there is no
     local-Redis equivalent. Shipping a hand-written Redis adapter whose
     contract-suite run has never actually executed is worse than
     documenting the deferral: an unverified adapter silently invites a
     production caller to trust behavior nobody proved.
3. **Trigger to build it:** the first module feature that actually needs a
   multi-node cache (per Architecture §12's sanctioned uses — session
   lookup, policy/entitlement snapshots) and runs in an environment where
   Redis and Docker are both available for verification. At that point the
   Redis adapter is built against the same `Cache` port, proven equivalent
   to `InMemoryLruCache` via a shared contract-test suite exercised against
   both, and Testcontainers-backed in CI exactly as the Postgres
   integration lane already is.

## Alternatives considered

- **Build the Redis adapter now, unverified locally, relying on CI's
  Testcontainers lane to catch bugs:** rejected — this project's standing
  practice (every adapter this epic) is to verify empirically against the
  real backend before writing production code, not after. Shipping first
  and hoping CI catches it inverts that discipline.
- **Add a Postgres-backed `Cache` adapter for symmetry with the other
  E03 Postgres adapters (RateLimiter, UnitOfWork, etc.):** rejected — those
  adapters back kernel ports whose correctness genuinely depends on
  Postgres's transactional/locking guarantees (atomic UPSERT, `FOR UPDATE
SKIP LOCKED`, transaction scoping). A cache has no such requirement; the
  in-memory reference already satisfies every sanctioned use in Architecture
  §12 for the single-node deployments this project currently targets.

## Consequences

- T42 closes as a documentation task: this ADR plus the dashboard/CHANGELOG
  entries recording that the in-memory reference (E02-T07) is the only
  shipped `Cache` adapter, Postgres is deliberately not one, and Redis is
  a scoped, triggered future task — not an open gap.
- Any module reaching for multi-node caching before the Redis adapter
  exists uses `InMemoryLruCache` and accepts single-node scope, or opens a
  new task to build the Redis adapter under the trigger condition above.
- If Docker/Testcontainers becomes available in this environment before a
  real caller needs Redis, that removes only the verification blocker —
  the dependency-approval blocker (no ADR sanctioning `ioredis`/`redis`
  yet) still needs its own decision when that adapter is actually built.
