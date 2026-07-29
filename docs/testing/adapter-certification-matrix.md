# Adapter Certification Matrix

- **Companion:** [contract-governance.md](contract-governance.md) defines
  what each status means and how a row moves between them.
- **Updated:** 2026-07-29, as each contract suite in the E04 executable-
  contracts effort lands. This table is the mechanically-checkable source
  of truth the fitness rule in `packages/architecture-tests` verifies
  against (every exported adapter class must appear here).

| Port                | In-memory adapter        | Postgres adapter              | Status                                                                 |
| ------------------- | ------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| `Cache`              | `InMemoryLruCache`         | — (ADR-0018: none, deferred)    | in-memory: **certified**. Postgres: **not applicable** (no backend exists) |
| `RateLimiter`        | `InMemoryRateLimiter`      | `PostgresRateLimiter`          | both: **certified** (E04-T01)                                          |
| `Logger`             | `CaptureLogger`, `NoopLogger` | — (pino adapter not yet built) | in-memory: **certified** (ADR-0022). Postgres/pino: **pending** (adapter doesn't exist yet) |
| `EventBus`           | `InMemoryEventBus`         | — (outbox relay is a different mechanism, not an `EventBus` implementation) | in-memory: **certified** (T04). Postgres: **not applicable** |
| `UnitOfWork`         | `InMemoryUnitOfWork`       | `PostgresUnitOfWork`           | both: **certified** (T05) — first end-to-end proof of the UnitOfWork → outbox → relay pipeline via a real `OutboxRelay.pollOnce()` |
| `Encrypter`          | `WebCryptoAesGcmEncrypter` | — (KMS-backed adapter named in the port doc as a future extension, not yet built) | WebCrypto: **certified** (T06). KMS: **pending** |
| `ProcessedEventStore`| `InMemoryProcessedEventStore` | `PostgresProcessedEventStore` | both: **certified** (T07) — found and fixed a real UUID-vs-readable-id bug in the suite itself before it shipped |
| `IdempotencyStore`   | `InMemoryIdempotencyStore` | `PostgresIdempotencyStore`     | pending                                                                 |
| Health-check (`checkLiveness`/`checkReadiness`) | n/a | n/a | **not applicable** — these are platform functions taking dependencies as parameters, not a port with swappable implementations; there is nothing for a contract-suite factory to construct. Covered instead by snapshot tests over the JSON payload shape (see contract-governance.md's snapshot-update rules). |

## Why `EventBus`'s Postgres column is "not applicable," not "blocked"

The transactional outbox (`OutboxRelay`, `platform.outbox`) is a
**different reliability mechanism** — at-least-once, checkpointed,
asynchronous delivery — not a second implementation of the kernel's
`EventBus` interface (`publish`/`subscribe`, synchronous, in-process,
at-most-once-per-call). Nothing in this codebase implements `EventBus`
against Postgres, and nothing should: the whole point of ADR-0009's design
is that they're separate mechanisms with separate contracts. `blocked`
would incorrectly imply a missing adapter is planned but stuck; it isn't
planned at all.

## Why `Cache`'s Postgres column is "not applicable," not "pending" or "blocked"

ADR-0018 is a considered, permanent decision not to build a Postgres-backed
`Cache` (caching the same store you'd offload reads from has no benefit).
`pending` would suggest it's simply not built yet; `blocked` would suggest
an external constraint (Docker) is the obstacle. Neither is true — this is
a deliberate architectural choice, recorded permanently.
