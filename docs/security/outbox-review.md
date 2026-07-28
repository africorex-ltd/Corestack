# Outbox Subsystem — Security Review

- **Status:** Consolidation-pass review, first formal pass since the outbox epic (E03-T02/T03, T10-T14) shipped
- **Scope:** `platform.outbox`, `platform.outbox_checkpoints`, `platform.processed_events`, their partitions, and every function/adapter that touches them
- **Related:** [outbox-architecture.md](../platform/outbox-architecture.md), [outbox-runbook.md](../operations/outbox-runbook.md)

## Privilege boundaries

The schema bootstrap (`ensureOutboxSchema`, E03-T10) accepts an optional
`applicationRole` parameter. When supplied, it issues:

```sql
REVOKE UPDATE, DELETE ON platform.outbox FROM <applicationRole>
```

This is opt-in, not enforced by default — a deployment that never passes
`applicationRole` gets no privilege restriction beyond ordinary Postgres
grants. **Recommendation carried forward, not yet a blocking finding:**
production deployments should always supply `applicationRole` so the
runtime application connection genuinely cannot mutate or delete
already-written outbox rows, matching the append-only guarantee below at
the database level, not just the application-code level.

## Append-only guarantees

Application code never issues `UPDATE`/`DELETE` against `platform.outbox`
itself — `writeOutboxEvents` is insert-only
([outbox-writer.md](../../packages/platform/docs/outbox-writer.md)), and
no other function in the package writes to that table. The only `DELETE`
in the entire subsystem targets `platform.processed_events`, scoped to
`event_id IN (SELECT id FROM platform.<partition>)`
(`postgres-outbox-partition-maintenance.ts:131`), executed in the same
transaction as dropping that exact partition. The append-only property for
`platform.outbox` itself is therefore:

- **Enforced at the database level** when `applicationRole` is configured
  (see above).
- **Enforced at the code level always** — no code path updates or deletes
  an outbox row directly; the only way rows leave the table is whole-partition
  `DROP TABLE`, gated by the retention safety check below.

## SQL injection surfaces

Every dynamic SQL string in the outbox subsystem was audited for
unparameterized user/operator input:

| Location                                                                                                                                                                           | Interpolated value                  | Safety                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres-outbox-schema.ts:104` — `REVOKE ... FROM ${applicationRole}`                                                                                                             | Operator-supplied role name         | **Safe by validation**: `assertSafeSqlIdentifier(applicationRole, "applicationRole")` runs first and throws on anything outside a safe identifier pattern before the string is built                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `outbox-partition-ddl.ts` — `CREATE TABLE ... PARTITION OF platform.${name} FOR VALUES FROM ('${from}') TO ('${to}')`                                                              | Partition name and bounds           | **Safe by construction**: `name` is generated by this package's own `outbox_YYYY_MM` template (never operator input); `from`/`to` are ISO instant strings produced by `computeMonthlyPartitionBounds`, never user input                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `postgres-outbox-partition-maintenance.ts:131,133` — `DELETE FROM platform.processed_events WHERE event_id IN (SELECT id FROM platform.${name})` and `DROP TABLE platform.${name}` | Partition name                      | **Safe by construction, not by validation**: `name` values only ever come from `listExistingPartitions`, which queries `pg_inherits`/`pg_class` for actual child partitions of `platform.outbox` and then discards (via `partitionUpperBound`'s anchored regex `^outbox_(\d{4})_(\d{2})$`) anything not matching that exact shape. A value reaching the `DROP TABLE`/`DELETE` interpolation has already round-tripped through Postgres's own catalog and the regex filter — there is no path from arbitrary string input to this interpolation point. **This is the one place in the subsystem where a table name reaches DDL unparameterized**, worth calling out explicitly even though the construction is currently sound; a future refactor that lets `listExistingPartitions`' source or the regex change must preserve this property. |
| `postgres-outbox-relay-store.ts` fetch queries                                                                                                                                     | `after.occurredAt`, `after.id`      | **Safe**: bound as real query parameters (`${after.occurredAt}::timestamptz`, `${after.id}::uuid`), never string-interpolated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Everywhere else (`writeOutboxEvents`, checkpoint reads/writes, `processed_events` reads/writes)                                                                                    | Event payloads, ids, consumer names | **Safe**: all bound as tagged-template parameters or `sql(rows)`/`sql(array)` helper forms — postgres.js parameterizes these, never raw string concatenation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**No finding.** All dynamic-SQL points either validate input explicitly
(`assertSafeSqlIdentifier`) or construct the interpolated value entirely
from this package's own deterministic naming convention with no reachable
path from external input — but the partition-maintenance case is
documented above so it is never "rediscovered" as if novel during a future
refactor.

## Checkpoint tampering

`platform.outbox_checkpoints` is a plain table with no row-level
protection beyond ordinary Postgres grants — the same `applicationRole`
REVOKE only touches `platform.outbox`, not the checkpoint table. **Finding
(P2, tracked, not blocking):** an application-role connection can currently
advance, rewind, or delete a checkpoint row directly, which would cause a
consumer to skip events (rewinding forward) or redeliver its entire
backlog (deleting the row) without going through `OutboxRelay`'s own
logic. Today this requires the same database credentials the relay itself
uses, so it is not a distinct external attack surface — but it is not
defense-in-depth either. Recommendation: extend the `applicationRole`
REVOKE to cover `outbox_checkpoints` for any role that isn't the relay's
own connection, once a role separation between "runs the relay" and "runs
ordinary application queries" exists (no such separation exists yet — the
platform doesn't currently model distinct runtime roles beyond the single
optional `applicationRole`).

## Replay abuse

The runbook's "how to replay a consumer" procedure is a direct
`DELETE`/`UPDATE` against `outbox_checkpoints`, run manually by an
operator with database access — there is no application-facing API that
triggers a replay, so there is no remote/unauthenticated replay-abuse
surface today. The risk is entirely about **operator error, not attacker
access**: replaying a consumer whose handler isn't actually idempotent
causes real duplicate side effects (e.g. duplicate billing charges if a
billing consumer bypasses `ProcessedEventStore`). The runbook's explicit
warning to verify idempotency before replaying is the primary control;
there is no code-level safeguard preventing a replay against a
non-idempotent consumer, because the platform has no way to know from the
checkpoint table alone whether a given consumer name is idempotent.

## Retention abuse

Covered in depth by
[outbox-partition-maintenance.md](../../packages/platform/docs/outbox-partition-maintenance.md)'s
"dangerous case" design note and proven by its integration suite: the
retention-drop phase requires `expectedConsumers` to be passed explicitly,
and a consumer missing from that list (or present with no/insufficient
checkpoint) blocks every partition it would need. The abuse scenario this
guards against is **misconfiguration**, not an external attacker —
`retentionMonths`/`expectedConsumers` are operator-supplied configuration,
never derived from request input, so there is no path for an
unauthenticated caller to trigger a drop at all. The residual risk is
purely operational: an operator who runs `maintainOutboxPartitions` with
an incomplete `expectedConsumers` list silently loses protection for the
omitted consumer. The runbook's "verify retention safety" procedure is the
mitigating control; there is no code-level way to detect "you forgot a
consumer" because the platform has no independent registry of which
consumers exist beyond what's passed in at call time.

## Denial-of-service vectors

| Vector                                                          | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unbounded batch size flooding a consumer                        | `OutboxRelayOptions.batchSize` defaults to 100 and is operator-configured, not derived from request input — no external actor controls it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A single slow/hanging consumer handler blocking other consumers | Not a risk: `OutboxRelay.#runRound` iterates subscriptions independently and catches per-subscription errors (`outbox-relay.ts:150-162`); a hung handler blocks only its own consumer's round, not others — though a handler that never resolves (rather than throwing) would still block that one consumer's round indefinitely, since there is no per-handler timeout today. **Finding (P2, tracked):** no timeout wraps `subscription.handler(event)` — a misbehaving handler can stall its own consumer forever. Not a cross-consumer risk, and not exploitable by an external attacker (handlers are operator-registered code, not user input), but worth a future timeout wrapper. |
| Partition growth without bound                                  | Mitigated by create-ahead/retention-drop existing at all (E03-T03) — but retention is opt-in; a deployment that never enables `retentionMonths` accumulates partitions indefinitely. This is a capacity-planning concern, not an attack surface, since nothing external controls event volume beyond what the application itself writes.                                                                                                                                                                                                                                                                                                                                                 |
| Large payloads written to the outbox                            | No size limit is enforced by `writeOutboxEvents` itself — relies on Postgres's own `jsonb` size limits and whatever validation the originating use case performs on its domain event before construction. Out of scope for this subsystem to re-validate; the outbox is a transport, not a schema-validation boundary for event payload shape.                                                                                                                                                                                                                                                                                                                                           |

## Information disclosure

- Error messages logged by the relay (`outbox-relay.ts:89-93,159-161`)
  include `eventId`, `eventName`, and `error.message` — no payload content
  is logged, limiting exposure if a handler's error message happens to
  echo part of its input. Loggers are operator-configured
  (`Logger` from `@corestack/kernel`); this subsystem does not itself
  choose a logging destination.
- The health/readiness contract
  ([health-contract.md](../platform/health-contract.md)) explicitly
  requires check failures to surface only a `status` enum value, never a
  raw database error message or connection string — this is a
  requirement on the not-yet-built T23, recorded here so the security
  posture is fixed before that code exists.
- `platform.outbox` payloads are stored in plaintext `jsonb` — no
  column-level encryption exists for outbox payload content. If any
  domain event ever carries sensitive data (secrets, credentials, full
  PII), that is a modeling decision for the emitting module, not something
  this subsystem currently protects against. Not a finding against the
  outbox itself, but worth flagging for any future consumer emitting
  sensitive payloads: **the outbox is not a secrets store, and nothing in
  this epic adds encryption-at-rest beyond whatever Postgres-level
  encryption the deployment itself configures.**

## Audit requirements

- `platform.processed_events` is itself a durable audit trail of which
  consumer processed which event, and when (`processed_at`) — this
  incidentally satisfies "was this event ever handled by this consumer,"
  though it is not a general-purpose audit log (no actor/reason recorded,
  only consumer + event id + timestamp).
- There is no audit trail today for **administrative actions** against the
  outbox itself — a manual checkpoint replay or a `maintainOutboxPartitions`
  call is not logged anywhere beyond whatever the operator's own shell
  history or the returned report captures. **Finding (P2, tracked):** once
  the observability contract's "replay requested" / "retention completed"
  log events (see
  [outbox-observability.md](../platform/outbox-observability.md)) are
  actually wired to a real logger call (currently contract-only, not
  implemented), this gap closes. Until then, operators following the
  runbook should independently record who ran a replay/retention action
  and why, outside the platform's own tooling.

## Summary of findings

| Severity | Finding                                                                                                                    | Status                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| P2       | `outbox_checkpoints` has no privilege restriction distinct from `platform.outbox`'s optional `applicationRole` REVOKE      | Tracked, not blocking — no role-separation model exists yet to extend it to                   |
| P2       | No timeout wraps a consumer handler invocation; a hung (not throwing) handler stalls its own consumer's round indefinitely | Tracked, not blocking — not cross-consumer, not externally triggerable                        |
| P2       | No audit log for administrative replay/retention actions                                                                   | Tracked — closes once observability contract's log events are implemented, not just specified |

No P0 or P1 findings. All three P2s are operational hardening items, not
exploitable by an external, unauthenticated actor — every abuse scenario
examined above requires the same database credentials or code-execution
context the legitimate relay/operator already has.
