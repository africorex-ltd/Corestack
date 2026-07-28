# Health & Readiness Contract

- **Status:** Contract — written before implementation, binds E03-T23
- **ADR references:** ADR-0009 (transactional outbox pattern, for relay-lag/backlog fields), ADR-0004 (Postgres behind ports, for dependency-connectivity fields)
- **Related:** [outbox-observability.md](outbox-observability.md), [outbox-architecture.md](outbox-architecture.md)

This document specifies the exact semantics and JSON shapes T23 must
implement. It exists so the health/readiness contract is fixed **before**
anyone writes code against it — per the founder's consolidation
directive, this is deliberately sequenced ahead of T23 in the task order.

**Scope note, added when T23 actually started:** `packages/platform` has
no `interface/` layer and no HTTP framework — ADR-0012's REST API is a
later epic. T23 ships **health computation**, not HTTP routes: functions
returning exactly the JSON shapes below (`checkLiveness()`,
`checkReadiness(deps)`), plus their types. A future transport layer wires
these into `GET /health/live` / `GET /health/ready`; T23 does not pick a
router.

## Terms

| Term          | Meaning                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Liveness**  | Is the process itself still able to make progress (not deadlocked, not out of memory, event loop not blocked)? A liveness failure means "restart me."                    |
| **Readiness** | Can this instance currently serve traffic correctly? A readiness failure means "stop routing to me, but don't restart" — e.g. mid-migration, or a dependency is down.    |
| **Degraded**  | The instance is ready and serving, but under one or more conditions worth surfacing (e.g. relay lag above a warning threshold) that don't yet warrant failing readiness. |

CoreStack does not conflate liveness and readiness into one check —
a database outage should fail readiness (stop routing), not liveness
(don't kill and restart a process that will come back healthy the moment
the database recovers).

## Response shapes

### `GET /health/live`

```json
{
  "status": "live",
  "timestamp": "2026-07-28T12:00:00.000Z"
}
```

No dependency checks. This endpoint must never call out to Postgres or any
other external system — a slow dependency must never cause a false
liveness failure and a restart loop.

### `GET /health/ready`

```json
{
  "status": "ready",
  "timestamp": "2026-07-28T12:00:00.000Z",
  "checks": {
    "database": { "status": "ok", "latencyMs": 4 },
    "migrations": { "status": "ok", "pendingCount": 0 },
    "clockSkew": { "status": "ok", "skewMs": 12 }
  },
  "modules": {
    "status": "healthy",
    "modules": {
      "tenancy": { "status": "healthy" }
    }
  }
}
```

`status` is one of `"ready" | "degraded" | "unready"`. Each entry in
`checks` is independently one of `"ok" | "degraded" | "failing"`. The
top-level `status` is the worst of any individual check
(`unready` > `degraded` > `ok`), **including** `modules.status` folded in
via the same ordering (`unhealthy` maps to `unready`, `degraded` maps to
`degraded`, `healthy` maps to `ok`).

**`modules` is `CoreStack.health()`'s own return value (E03-T21),
embedded verbatim, not reinvented.** `ModuleInstance.health()` (T20) is a
per-module check already wired through `createCoreStack()`'s worst-of
aggregation — readiness's job is to fold that existing result into the
system-level checks above, not to build a second module-health mechanism.
This was an omission in this contract's original draft, corrected once
T23 actually started and the existing `CoreStack.health()` was found.

### Degraded / unready example

```json
{
  "status": "degraded",
  "timestamp": "2026-07-28T12:00:00.000Z",
  "checks": {
    "database": { "status": "ok", "latencyMs": 6 },
    "migrations": { "status": "ok", "pendingCount": 0 },
    "clockSkew": { "status": "ok", "skewMs": 8 },
    "relayLag": {
      "status": "degraded",
      "consumers": {
        "billing-projector": {
          "lagMs": 45000,
          "threshold": { "degraded": 30000, "unready": 300000 }
        }
      }
    }
  }
}
```

## Per-dimension semantics

| Dimension                                           | `ok`                                                                                          | `degraded`                                                                        | `unready` / `failing`                                                                                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Database connectivity**                           | A trivial query (`SELECT 1`) succeeds within budget                                           | Succeeds but above a latency warning threshold (value TBD by T23, not fixed here) | Query fails or times out                                                                                                                                                                 |
| **Migrations pending**                              | `platform.module_migrations` shows no module behind its expected version                      | N/A — either pending or not                                                       | One or more modules have unapplied migrations for their registered version — **this instance must not serve writes that assume the new schema**                                          |
| **Relay lag**                                       | Every consumer's `lagMs` (from `OutboxRelay`'s `onLag`) is under the degraded threshold       | One or more consumers exceed the degraded threshold but not the unready threshold | One or more consumers exceed the unready threshold — relay has stalled long enough to be an operational incident, not routine lag                                                        |
| **Backlog size**                                    | Backlog (events after checkpoint) under a configured threshold                                | Above the warning threshold                                                       | Above the critical threshold                                                                                                                                                             |
| **Database connectivity for the relay's own reads** | folded into "Database connectivity" above — the relay has no separate connection health today | —                                                                                 | —                                                                                                                                                                                        |
| **Clock skew**                                      | `abs(Date.now() - (SELECT now() FROM Postgres))` within tolerance                             | Skew above a warning bound                                                        | Skew large enough to threaten checkpoint/partition-bound correctness (see the timezone bug this epic already fixed once — clock skew is a related, distinct risk to call out explicitly) |
| **Version mismatch**                                | **Not implementable as originally specified — see below**                                     | —                                                                                 | —                                                                                                                                                                                        |

## Known gap: version mismatch is not implementable as originally specified

The original draft of this contract specified comparing "the running
binary's version" against what `platform.module_migrations` expects.
That table's `version` column (`platform.module_migrations(module text,
version integer, applied_at timestamptz, checksum text)`) is a **migration
version per module** — how far that module's own schema has progressed —
not an application/binary release version. There is no field anywhere in
the shipped schema for "what binary version is expected." Rather than
invent a new column to serve a check this contract merely asserted should
exist, this dimension is **not implemented**: T23 omits `versionMismatch`
from the `checks` object entirely. If binary/schema version compatibility
becomes a real need, it requires its own schema decision (a new column or
table), not a readiness-check retrofit.

## Clock skew: redefined against what's actually measurable

The original draft said "within tolerance of a trusted time source
(mechanism TBD)." There is no external trusted time source available to
this package. The pragmatic, already-available measurement is skew
between the process's own clock and the database's:
`abs(Date.now() - postgresNow.getTime())` from `SELECT now()` — a query
readiness is already making for the database-connectivity check, so this
costs nothing extra. This is also the skew that actually threatens
correctness here: partition-bound DDL and checkpoint comparisons are
Postgres-timestamp-relative (see the timezone bug this epic already
fixed once), so skew against Postgres's own clock is the relevant risk,
not skew against an abstract "true" time.

## Known gap: backlog size is not yet computable

`outbox_backlog_size` per consumer requires counting outbox rows strictly
after a consumer's checkpoint. **No such query exists in
`OutboxRelayStore` today** — `OutboxRelay` only exposes lag
(`onLag(consumer, lagMs)`), which is a proxy for backlog age, not row
count. Resolved by T23 as an **optional** port member —
`countBacklog?(consumer: string): Promise<number>` — added to
`OutboxRelayStore` as an additive, non-breaking change (existing
implementers remain valid since the member is optional) rather than a
required one, which would have been a breaking public-API change.
Readiness includes the `backlog` check only when the store actually
provides `countBacklog`.

This contract originally posed this as an open choice between adding
`countBacklog` or shipping on lag alone; option 1 (optional method) is
what T23 implemented, since it costs nothing and gives every future
`OutboxRelayStore` implementer the choice of whether to support it.

## Relay lag is push-based — readiness needs a recorder, and a staleness check

`OutboxRelayOptions.onLag(consumer, lagMs)` is a callback fired once per
poll round; there is no getter on `OutboxRelay` itself. Readiness needs a
small recorder that `onLag` writes into and the check reads from — this
recorder also records **when** each lag value arrived. A relay that has
stopped polling entirely (crashed, never started, `stopIntake()` called
and never resumed) stops calling `onLag` altogether; without recording
the age of the last reading, a stale "everything was fine 20 minutes ago"
value would read as healthy forever — exactly the stalled-delivery
scenario the runbook's "diagnose stalled delivery" procedure exists to
catch manually. Readiness therefore also fails a consumer whose most
recent `onLag` reading is older than a configured staleness bound, not
just one whose last reported `lagMs` was high.

## Degraded vs. unready thresholds are configuration, not fixed here

This contract fixes the **shape** and **names**; exact millisecond/count
thresholds are operational configuration T23 must expose (env vars or a
config object), not values hardcoded in this document. Baking specific
numbers into an architecture doc would make them harder to tune per
deployment than making them configuration from day one.

## Failure modes for the health endpoint itself

| Failure                                                      | Behavior                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A dependency check throws (e.g. Postgres connection refused) | That check's `status` is `"failing"`, never an unhandled exception — the endpoint itself must always return valid JSON with a 200 (readiness state is communicated in the body, not via HTTP status, so load balancers and dashboards get a consistent parse target) |
| The health endpoint is itself under memory/CPU pressure      | Out of scope for T23 to solve generally; liveness intentionally has zero dependency checks so it degrades last                                                                                                                                                       |

## Security considerations

Health/readiness responses must not leak internal detail beyond what
operators need: no stack traces, no connection strings, no internal
hostnames. `checks.database.status` is `"failing"`, not the underlying
Postgres error message. See [outbox-review.md](../security/outbox-review.md)
for the outbox subsystem's own security review, which this endpoint
partially surfaces (relay lag, backlog) without exposing.
