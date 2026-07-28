# Component Spec — `platform.outbox` Schema Bootstrap

- **Task:** E03-T10 · **Status:** Implemented · **Category:** ADP (Postgres adapter; no application-layer orchestration in this task)
- **ADR references:** ADR-0009 (transactional outbox pattern), ADR-0004 (Postgres behind ports), ADR-0010 (adapters as optional-peer subpath exports — `./postgres`)
- **Design docs:** [Database §3](../../../docs/architecture/DATABASE.md) (`platform.outbox`, `platform.outbox_checkpoints`, `platform.processed_events` exact schemas)

## Contract

**Purpose:** idempotently create the three tables the transactional outbox
pattern (ADR-0009) depends on — `platform.outbox` (partitioned monthly by
`occurred_at`), `platform.outbox_checkpoints`, and `platform.processed_events`
— plus the outbox's two required indexes, so that the outbox writer (T11)
and relay (T12) have somewhere real to write and read from. This task
creates schema only; it does not write or relay events.

**Public surface:**

| Export                      | Layer          | Purpose                                                                 |
| ---------------------------- | -------------- | ------------------------------------------------------------------------ |
| `ensureOutboxSchema(sql, options)` | infrastructure, exported via `./postgres` | Bootstraps all three tables, both indexes, and current+N-months-ahead partitions |
| `EnsureOutboxSchemaOptions`  | infrastructure, exported via `./postgres` | `referenceDate` (defaults to `new Date()`), `applicationRole` (optional append-only enforcement) |
| `computeMonthlyPartitionBounds(referenceDate, monthsAhead)` | domain | Pure function computing partition names/bounds — no I/O |
| `assertSafeSqlIdentifier(identifier, purpose)` | domain | Validates a Postgres identifier before DDL interpolation (throws `ValidationError`) |
| `ensurePlatformSchema(sql)` | infrastructure, exported via `./postgres` | Shared `CREATE SCHEMA IF NOT EXISTS platform`, extracted from T02 and reused here |

## The partitioning constraint this component resolves

The approved DB design (§3) marks `platform.outbox` as partitioned monthly
by `occurred_at`, with logical primary key `id`. Postgres requires every
column in a partition key to also appear in any primary key declared on a
partitioned table — a bare `PRIMARY KEY (id)` is rejected outright. This is
a Postgres mechanics constraint, not a schema redesign: the **physical** PK
is `(id, occurred_at)`, while `id` remains the sole logical identity
(nothing outside this file depends on `occurred_at` for uniqueness — no
other approved table has an FK into `platform.outbox`).

`ensureOutboxSchema` bootstraps the current month's partition plus one
month ahead by default, so the outbox is immediately writable without
depending on the not-yet-built T03 partition-maintenance job. Inserting a
row whose `occurred_at` falls outside every bootstrapped partition fails —
proven directly against real Postgres in the integration suite, not
asserted.

## Failure modes

| Failure                                                            | Behavior                                                                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-running `ensureOutboxSchema` against an already-bootstrapped DB  | No-op — every DDL statement uses `IF NOT EXISTS`; verified idempotent against real Postgres                                                                               |
| Insert with `occurred_at` outside every bootstrapped partition      | Postgres rejects the insert (no partition covers it) — this is the intended failure mode until T03's partition-maintenance job keeps future months bootstrapped ahead of time |
| Duplicate `(consumer, event_id)` insert into `processed_events`     | Rejected by the composite primary key — this is the mechanism T14's idempotent-consumer helper relies on for at-most-once processing per consumer                        |
| `applicationRole` passed but not a valid lowercase SQL identifier   | `assertSafeSqlIdentifier` throws a `ValidationError` before any DDL runs, closing the injection path an unvalidated role name interpolated into `REVOKE ... FROM ${role}` would open |

## Retry / timeout / cancellation

None at this layer — this is boot-time DDL, not a request-path operation.
A failure here (e.g. insufficient privileges to `CREATE TABLE`) is an
operator/deployment problem to fix and rerun, not something to retry
automatically.

## Concurrency guarantees

All statements use `IF NOT EXISTS` / are otherwise idempotent, so
concurrent callers (e.g. two instances racing to bootstrap on startup) are
safe modulo ordinary Postgres DDL-level locking — no application-level
locking is added by this component, unlike T02's migration runner, because
there is no ordered sequence of steps here that could partially apply and
leave inconsistent state; each `CREATE ... IF NOT EXISTS` is independently
idempotent.

## Performance

Negligible — a handful of DDL statements run once at boot/deploy time, not
on any request path. Not formally benchmarked (pending E04-T13, same as
T02).

## Security considerations

`applicationRole` is validated via `assertSafeSqlIdentifier` before being
interpolated into a `REVOKE` statement — the same class of defense T02's
module-name validation provides for its own DDL paths. The optional
`REVOKE UPDATE, DELETE ON platform.outbox FROM ${applicationRole}` is a
mechanism only: it enforces append-only access for whichever single role
is named, but the full two-role model (a write-only app role plus a
separate relay/read role) is T30's job, not this task's. Event payloads
(`jsonb`) are opaque to this component — validating their contents is the
producing module's responsibility, not the outbox schema's.

## Observability

None added directly (boot-time DDL, same posture as T02's migration
runner) — there's nothing to observe about a one-time idempotent schema
bootstrap that isn't already visible via Postgres's own DDL logging.

## Testing

**13 tests total**: 5 pure domain tests for `computeMonthlyPartitionBounds`
(current-month-only, N-months-ahead in order, year-boundary rollover, UTC
anchoring regardless of local time, lexicographic sort matching
chronological order) and 8 for `assertSafeSqlIdentifier` (valid-identifier
acceptance, a parametrized rejection list including a SQL-injection-shaped
string, and error-metadata verification); **5 real-Postgres integration
tests** (Testcontainers) proving: idempotent re-bootstrap, all three tables
plus both indexes actually exist, the table is genuinely partitioned (a
row inside the current or next month's partition inserts; a row several
months outside both is rejected by Postgres itself, not by application
code), `outbox_checkpoints`/`processed_events` accept well-formed rows and
reject a duplicate `(consumer, event_id)` pair, and — the test that most
directly earns its keep — a real Postgres role granted full DML on
`platform.outbox`, then handed to `ensureOutboxSchema` as
`applicationRole`, can still `INSERT` afterward but has `UPDATE` and
`DELETE` genuinely rejected with a permission-denied error from Postgres
itself (verified via `SET ROLE` on a reserved connection), not merely
inferred from the `REVOKE` statement having run without error.

## Design rationale

Why extract `ensurePlatformSchema` out of T02's migration-runner adapter
instead of duplicating `CREATE SCHEMA IF NOT EXISTS platform` here? Both
components bootstrap objects into the same `platform` schema; duplicating
the statement risks the two copies drifting (e.g. one adds an `AUTHORIZATION`
clause the other doesn't) with no benefit, since the statement is
identical by construction. Why default to bootstrapping only the current
month plus one month ahead, rather than e.g. a year's worth up front?
Matches the approved partition-maintenance design (T03): a single
just-in-case month is enough to make the outbox usable before T03 exists,
without this task quietly taking over T03's actual job of keeping future
partitions rolling forward indefinitely.
