# Component Spec — `platform.module_migrations` Runner

- **Task:** E03-T02 · **Status:** Implemented · **Category:** APP + ADP (pure orchestration + Postgres adapter)
- **ADR references:** ADR-0015 (zero-downtime N/N+1 upgrades), ADR-0004 (Postgres behind ports), ADR-0010 (adapters as optional-peer subpath exports — `./postgres`)
- **Design docs:** [Database §3](../../../docs/architecture/DATABASE.md) (`platform.module_migrations` exact schema), [Database §18](../../../docs/architecture/DATABASE.md) (migration strategy, CONCURRENTLY handling)

## Contract

**Purpose:** apply a module's pending migrations (from T01's `MigrationSet`) against Postgres, tracking progress in `platform.module_migrations`, refusing to proceed on detected drift, and serializing concurrent runner processes.

**Public surface:**

| Export                                                           | Layer                                     | Purpose                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `runMigrations(migrationSet, store)`                             | application                               | The orchestration: ordering, drift detection, locking discipline → `Result<MigrationRunResult, ValidationError>` |
| `MigrationRunnerStore` (port)                                    | application                               | `getState`, `applyMigration`, `withModuleLock`                                                                   |
| `computeChainChecksum` / `computeAdvisoryLockKey`                | domain                                    | Pure helpers (see Design rationale)                                                                              |
| `PostgresMigrationRunnerStore` / `ensureMigrationTrackingSchema` | infrastructure, exported via `./postgres` | The reference adapter                                                                                            |
| `InMemoryMigrationRunnerStore` (`/testing`)                      | testing                                   | Fake with an in-process mutex simulating the lock                                                                |

## The schema tension this component resolves

The approved DB design (§3) stores **one row per module**
(`module PK, version, applied_at, checksum`) — not one row per applied
migration file. A single checksum column cannot, on its face, detect drift
in migration #3 once migrations #4 and #5 have also been applied. This
component resolves that **without adding any column or table** (no
redesign): the stored `checksum` is a **cumulative chain hash** —
`sha256(checksum_1 + "\n" + checksum_2 + ... + checksum_N)` — over every
applied migration's own T01 checksum, in order. Editing, reordering, or
deleting _any_ previously-applied file changes its own checksum, which
changes every chain checksum from that point forward, so recomputing the
chain for "migrations 1..N on disk today" and comparing it to the one
recorded value at version N detects drift anywhere in the history.

## Failure modes

| Failure                                                                      | Behavior                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recorded version but a checksum mismatch on recompute                        | `ValidationError`: "migration history has drifted... check for hand-edited or reordered migration files" — **nothing applied**                                                                                                                                                                 |
| Recorded version N but fewer than N migration files exist on disk            | `ValidationError` naming the exact counts — catches a deleted migration file distinctly from an edited one                                                                                                                                                                                     |
| A migration's SQL fails                                                      | The transaction (non-`@concurrent` migrations) rolls back completely — verified against real Postgres: the table the failing migration would have created does not exist, and the tracking row stays at the previous version                                                                   |
| Two runner processes call `runMigrations` for the same module simultaneously | The second blocks on the real Postgres advisory lock until the first fully finishes; verified against real Postgres by racing two separate connection pools against a `CREATE TABLE` migration — a broken lock would surface as a live "relation already exists" error, not a mocked assertion |
| A `@concurrent: true` migration (e.g. `CREATE INDEX CONCURRENTLY`)           | Runs in autocommit, **not** wrapped in `.begin()` — verified for real: Postgres itself rejects `CREATE INDEX CONCURRENTLY` inside a transaction block, so the integration test succeeding is direct proof the code path is correct, not an assumption                                          |

## Retry / timeout / cancellation

No retry at this layer — a failed migration is a code/data problem retrying
won't fix; the caller (future CLI `corestack migrate`) surfaces the
`ValidationError` for a human to act on. The advisory lock (`pg_advisory_lock`)
blocks indefinitely by design — waiting your turn to migrate is correct
behavior, not a timeout condition; an operator with a genuinely stuck
migration investigates via `pg_locks`, this component doesn't second-guess
that with an arbitrary wait bound.

## Concurrency guarantees

The **whole** check-and-apply sequence for a module runs inside
`withModuleLock`, on one dedicated (`reserve()`d) connection holding a
session-scoped `pg_advisory_lock` for its duration — migrations for
_different_ modules never contend (a hash of the module name is the lock
key). **Operational requirement:** the injected connection pool must allow
at least 2 concurrent connections (one for the lock, one for the migration
transactions) — documented in the adapter's own TSDoc; a pool of size 1
would deadlock.

## Performance

Cost is dominated by the migrations' own SQL, not this component's
overhead (one lookup query, one chain-hash computation per migration, one
upsert). Not formally benchmarked (pending E04-T13); this runs at
boot/deploy time, not on a request path.

## Security considerations

Module names are validated (`assertValidModuleName`, T01) before ever
reaching a SQL statement, closing the same path-traversal-adjacent class
of risk as the filesystem adapter. Migration SQL itself is trusted
repository content (authored by contributors), not user input — this
component's job is applying it correctly and safely, not sandboxing it.

## Observability

None added directly (a boot-time component); its `ValidationError`
failures carry structured `metadata` (module, recorded version, found-on-
disk count) sufficient for a precise operator-facing message from whatever
calls it (the CLI, later).

## Testing

**15 tests total**: 8 pure orchestration tests (in-memory fake) covering
ordering, partial-application, no-op-when-current, both drift scenarios,
chain-checksum accumulation, and same-module-serializes /
different-modules-don't via the fake's in-process mutex; **7 real-Postgres
integration tests** (Testcontainers) proving actual DDL execution, real
transactional rollback, real drift detection against a corrupted row, real
cross-connection advisory-lock serialization, and real `CREATE INDEX
CONCURRENTLY` success outside a transaction. Two genuine bugs were caught
and fixed while writing these tests before they ever ran against CI: an
`await`-missing checksum comparison in the integration test itself, and a
module-name validation error from using an underscored test-schema name
where a hyphenated module name was required (T01's approved pattern).

## Design rationale

Why compute the checksums as pure domain functions rather than inline SQL
or ORM logic? Consistency with T01: hashing is deterministic, I/O-free
logic that belongs in `domain/`, reusable by any future adapter (a
non-Postgres `MigrationRunnerStore`, should one ever be needed) without
duplicating the algorithm. Why session-scoped advisory locks (requiring a
reserved connection) instead of transaction-scoped (`pg_advisory_xact_lock`,
which auto-releases and needs no connection juggling)? Because the lock
must span _multiple_ migration transactions in sequence — a single
`pg_advisory_xact_lock` only lives as long as one transaction, which would
release the lock between migrations 1 and 2, reopening the exact race this
component exists to close.
