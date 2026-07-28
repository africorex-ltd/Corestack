# Health & Readiness Contract

- **Status:** Contract — written before implementation, binds E03-T23
- **ADR references:** ADR-0009 (transactional outbox pattern, for relay-lag/backlog fields), ADR-0004 (Postgres behind ports, for dependency-connectivity fields)
- **Related:** [outbox-observability.md](outbox-observability.md), [outbox-architecture.md](outbox-architecture.md)

This document specifies the exact semantics and JSON shapes T23 must
implement. It exists so the health/readiness endpoint's contract is fixed
**before** anyone writes code against it — per the founder's consolidation
directive, this is deliberately sequenced ahead of T23 in the task order.

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
  }
}
```

`status` is one of `"ready" | "degraded" | "unready"`. Each entry in
`checks` is independently one of `"ok" | "degraded" | "failing"`. The
top-level `status` is the worst of any individual check
(`unready` > `degraded` > `ok`).

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

| Dimension                                           | `ok`                                                                                              | `degraded`                                                                        | `unready` / `failing`                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Database connectivity**                           | A trivial query (`SELECT 1`) succeeds within budget                                               | Succeeds but above a latency warning threshold (value TBD by T23, not fixed here) | Query fails or times out                                                                                                                                                                 |
| **Migrations pending**                              | `platform.module_migrations` shows no module behind its expected version                          | N/A — either pending or not                                                       | One or more modules have unapplied migrations for their registered version — **this instance must not serve writes that assume the new schema**                                          |
| **Relay lag**                                       | Every consumer's `lagMs` (from `OutboxRelay`'s `onLag`) is under the degraded threshold           | One or more consumers exceed the degraded threshold but not the unready threshold | One or more consumers exceed the unready threshold — relay has stalled long enough to be an operational incident, not routine lag                                                        |
| **Backlog size**                                    | Backlog (events after checkpoint) under a configured threshold                                    | Above the warning threshold                                                       | Above the critical threshold                                                                                                                                                             |
| **Database connectivity for the relay's own reads** | folded into "Database connectivity" above — the relay has no separate connection health today     | —                                                                                 | —                                                                                                                                                                                        |
| **Clock skew**                                      | Instance's clock within tolerance of a trusted time source (mechanism TBD by T23)                 | Skew above a warning bound                                                        | Skew large enough to threaten checkpoint/partition-bound correctness (see the timezone bug this epic already fixed once — clock skew is a related, distinct risk to call out explicitly) |
| **Version mismatch**                                | Running binary's version matches what `platform.module_migrations` expects for its own module row | N/A                                                                               | Binary older or newer than the schema it's talking to expects — refuse readiness rather than risk writing data the schema doesn't support (or the reverse)                               |

## Known gap: backlog size is not yet computable

`outbox_backlog_size` per consumer requires counting outbox rows strictly
after a consumer's checkpoint. **No such query exists in
`OutboxRelayStore` today** — `OutboxRelay` only exposes lag
(`onLag(consumer, lagMs)`), which is a proxy for backlog age, not row
count. T23 has two honest options, and this contract does not pick one on
its own:

1. Add `OutboxRelayStore.countBacklog(consumer): Promise<number>` (a small,
   additive change to an already-shipped port) and wire it into the
   readiness check.
2. Ship T23 using lag alone as the readiness signal for the outbox, and
   defer backlog-count as a documented follow-up.

Either is acceptable; this document exists so T23 doesn't have to
_discover_ the gap mid-implementation — the JSON shape above already
includes a `backlog` field precisely so T23's decision is "how do I
compute this" and not "should this field exist."

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
