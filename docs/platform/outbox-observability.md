# Outbox Observability Contract

- **Status:** Contract — binding on every current and future outbox adapter/consumer
- **ADR references:** ADR-0009 (transactional outbox pattern)
- **Related:** [outbox-architecture.md](outbox-architecture.md), [health-contract.md](health-contract.md), [outbox-relay.md](../../packages/platform/docs/outbox-relay.md)

This is the fixed vocabulary every future outbox adapter, relay
configuration, or consumer must emit. It exists so that dashboards, alerts,
and the health endpoint (T23) can be built against names that don't drift
per-adapter. It does not mandate _how_ metrics/logs are shipped (no
Prometheus/OpenTelemetry binding is chosen yet) — only the names, units,
and emission points.

## What is live today vs. contract-only

| Signal                   | Status                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Relay lag (per consumer) | **Live** — `OutboxRelayOptions.onLag(consumer, lagMs)`, called every poll round                                                                                                                              |
| Everything else below    | **Contract only** — no metrics emitter exists yet in the platform package; this table is the target shape for whoever wires one in (T23 for health-relevant fields, a later observability epic for the rest) |

Nothing in this document requires the metrics to be scraped a particular
way today. `onLag` is a plain callback — a caller wires it to whatever
metrics backend they use. This contract's job is making sure that wiring,
whenever it happens, uses these exact names.

## Metrics

| Name                                | Type      | Labels                   | Description                                                                                       | Source today                                                                                                                                                                                                          |
| ----------------------------------- | --------- | ------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outbox_backlog_size`               | gauge     | `consumer`               | Events in `platform.outbox` strictly after the consumer's checkpoint                              | **Not yet computable** — needs a new `OutboxRelayStore.countBacklog(consumer)` method; no query exists today. Required before T23 can report a numeric backlog field (see health-contract.md's note on this same gap) |
| `outbox_relay_lag_ms`               | gauge     | `consumer`               | `Date.now() - lastAdvancedCheckpoint.occurredAt`, 0 once caught up                                | **Live** — `onLag` callback, `outbox-relay.ts:104`                                                                                                                                                                    |
| `outbox_dispatch_latency_ms`        | histogram | `consumer`, `event_name` | Wall-clock time of one `subscription.handler(event)` call                                         | Not yet measured — no timing wraps the handler call in `runSubscription` today                                                                                                                                        |
| `outbox_checkpoint_age_ms`          | gauge     | `consumer`               | Time since the checkpoint last advanced (distinct from lag: a consumer can be caught up but idle) | Not yet computed — derivable from `getCheckpoint` plus a stored "last advanced at" wall-clock time, which isn't persisted today                                                                                       |
| `outbox_retry_count`                | counter   | `consumer`, `event_name` | Number of times a batch was redelivered because of a prior handler failure                        | Not yet counted — `runSubscription` logs the failure but doesn't count retries as a distinct metric                                                                                                                   |
| `outbox_duplicate_suppressed_total` | counter   | `consumer`               | Number of times `idempotentHandler` found `hasProcessed` true and skipped the handler             | Not yet counted — `idempotentHandler` (kernel) performs the skip but doesn't emit a metric                                                                                                                            |
| `outbox_partition_count`            | gauge     | (none)                   | Number of `outbox_YYYY_MM` partitions currently attached                                          | Not yet computed — derivable from the same `pg_inherits` query `maintainOutboxPartitions` already runs, just not exposed as a standalone metric call                                                                  |

## Logs

Every entry below names the **event**, not a literal log-line format —
each adapter chooses its own structured-log shape but must include at
least the listed fields.

| Event                 | When                                                                                                          | Required fields                                                            | Source today                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relay start`         | `OutboxRelay.start()` is called                                                                               | none beyond timestamp                                                      | **Not yet logged** — `start()` has no logger call                                                                                                                      |
| `relay stop`          | `stopIntake()` is called                                                                                      | none beyond timestamp                                                      | **Not yet logged** — `stopIntake()` has no logger call                                                                                                                 |
| `batch fetched`       | `fetchBatch` returns a non-empty batch                                                                        | `consumer`, `count`, `after` cursor                                        | **Not yet logged** — `runSubscription` doesn't log successful fetches, only failures                                                                                   |
| `batch dispatched`    | a batch finishes its per-event dispatch loop (success or partial)                                             | `consumer`, `dispatched_count`, `stopped_on_failure`                       | **Not yet logged**                                                                                                                                                     |
| `checkpoint advanced` | `advanceCheckpoint` succeeds                                                                                  | `consumer`, `occurred_at`, `id`                                            | **Not yet logged**                                                                                                                                                     |
| `replay requested`    | an operator manually resets/rewinds a consumer's checkpoint (see the runbook's "replay a consumer" procedure) | `consumer`, `from_cursor`, `to_cursor`, `operator`                         | **No such operation exists as code yet** — replay today is a manual SQL procedure (see outbox-runbook.md); once a `replayFrom` API exists, it must log this            |
| `retention skipped`   | `maintainOutboxPartitions` blocks a partition drop                                                            | `partition`, `reason` (mirrors `OutboxPartitionMaintenanceReport.blocked`) | **Report is returned, not logged** — the caller must log the report today; the function itself is silent (see outbox-partition-maintenance.md's Observability section) |
| `retention completed` | a partition drop + `processed_events` prune commits                                                           | `partition`, `pruned_event_count`                                          | **Report is returned, not logged** — same as above                                                                                                                     |

**Existing behavior today:** `OutboxRelay` already logs one thing —
`subscription.handler` throwing — via `logger?.warn` with `eventId`,
`eventName`, and the error message (`outbox-relay.ts:89-93`), and a
round-level failure with just the error message (`outbox-relay.ts:159-161`).
Everything else in the table above is a gap this contract records
honestly rather than a feature already shipped.

## Why this is a contract now, with mostly unimplemented rows

Per the founder's Platform Maturity Mode, every infrastructure component
ships with observability _scoped_ from day one — that doesn't mean every
metric is wired before its first consumer exists. Fixing the names and
units now means the first adapter that actually wires a metrics backend
(no epic assigned yet) has zero design decisions left to make; it only has
to plumb `onLag`-style callbacks through the remaining gaps in the table
above. Recording "not yet implemented" honestly, per row, is more useful to
the next contributor than a document that reads as if these already exist.
