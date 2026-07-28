# Component Spec — Health & Readiness

- **Task:** E03-T23 · **Status:** Implemented (computation only — no HTTP transport yet) · **Category:** APP (pure orchestration) + ADP (Postgres adapters)
- **ADR references:** ADR-0009 (transactional outbox pattern, for relay-lag/backlog fields), ADR-0004 (Postgres behind ports), ADR-0012 (REST API — a later epic; this task does not implement it), ADR-0014 (module lifecycle contract — `ModuleInstance.health()`/`CoreStack.health()` are folded in, not reinvented)
- **Design docs:** [health-contract.md](../../docs/platform/health-contract.md) — the binding contract, written before this implementation and amended in the same commit as this spec where the contract's original draft turned out not to match what's actually buildable (module folding, version-mismatch, clock-skew redefinition)

## Contract

**Purpose:** compute the exact liveness/readiness JSON shapes
`health-contract.md` specifies. `packages/platform` has no `interface/`
layer or HTTP framework yet (ADR-0012's REST API is a later epic) — this
ships as plain functions, not routes. A future transport wires
`checkLiveness()`/`checkReadiness()` into `GET /health/live` /
`GET /health/ready`.

**Public surface:**

| Export                                                                                                         | Layer                        | Purpose                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `checkLiveness(clock)`                                                                                         | application                  | Zero-dependency liveness check                                                                                                      |
| `checkReadiness(deps)`                                                                                         | application                  | Full readiness computation — database, migrations, clock skew, optional relay lag, optional backlog, optional module-health folding |
| `RelayLagRecorder`                                                                                             | application                  | In-memory recorder bound to `OutboxRelayOptions.onLag`; tracks each consumer's latest lag reading and when it arrived               |
| `worstCheckStatus`, `worstReadinessLevel`, `checkStatusToReadinessLevel`, `moduleHealthStatusToReadinessLevel` | domain                       | Pure status-ordering helpers                                                                                                        |
| `PostgresDatabasePing`                                                                                         | infrastructure, `./postgres` | `DatabasePingPort` — `SELECT 1` for latency, `SELECT now()` for the database's own clock                                            |
| `PostgresMigrationsStatus`                                                                                     | infrastructure, `./postgres` | `MigrationsStatusPort` — applied version per module from `platform.module_migrations`                                               |
| `OutboxRelayStore.countBacklog?`                                                                               | application (port extension) | Optional backlog-count member added to the already-shipped E03-T12 port; implemented by `PostgresOutboxRelayStore`                  |

## Three corrections to the original contract, made when implementation actually started

The contract was deliberately written before any code, per the founder's
Infrastructure Consolidation directive — and, as expected for a
contract-first document, three things in it didn't survive contact with
the actual codebase:

1. **Module health was missing entirely.** `ModuleInstance.health()`
   (T20) and `CoreStack.health()` (T21) already exist and already
   aggregate per-module health with worst-of logic. Readiness folds
   `CoreStack.health()`'s result into its own `modules` field verbatim,
   via `ReadinessDeps.coreStack` — it does not reimplement module
   aggregation. `health-contract.md` was amended in the same pass this
   was discovered, not left silently unreconciled.
2. **`versionMismatch` is not implementable as specified.**
   `platform.module_migrations.version` is a per-module _migration_
   version, not an application/binary release version — no field exists
   anywhere in the shipped schema for the latter. Rather than invent a
   schema change to serve a check the contract merely asserted should
   exist, this dimension is omitted from `checks` entirely.
3. **Clock skew is measured against Postgres's own clock, not an
   abstract "trusted time source."** There is no external time source
   available to this package. `abs(Date.now() - (SELECT now()))` is both
   the pragmatic, already-available measurement (piggybacking on the
   same round trip the database-connectivity check already makes) and
   the actually-relevant one: partition-bound DDL and checkpoint
   comparisons are Postgres-timestamp-relative (the timezone bug this
   epic already fixed once), so skew against Postgres is the risk that
   matters here.

## Failure modes

| Failure                                                                | Behavior                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.ping()` throws (connection refused, timeout)                 | `database.status = "failing"`; `clockSkew.status = "failing"` too, since skew can't be measured without a reachable database clock — never an unhandled exception out of `checkReadiness`                                                                                                                                                                |
| `migrations.appliedVersions()` throws                                  | `migrations.status = "failing"`                                                                                                                                                                                                                                                                                                                          |
| A module is behind its expected migration version                      | `migrations.status = "failing"`, `pendingModules` lists every such module — readiness must not serve writes assuming a schema version that isn't there yet                                                                                                                                                                                               |
| A relay stops polling (crashed, never started, paused and not resumed) | Its last `onLag` reading grows stale; once the reading's age exceeds `staleAfterMs`, that consumer reads as `"failing"` regardless of the `lagMs` value it last reported — a silent-good-forever reading is exactly the "stalled delivery" case the runbook's manual diagnosis procedure exists to catch, so the automated check must not miss it either |
| `coreStack.health()` throws                                            | Not caught internally — `checkReadiness` propagates the exception. Unlike the database/migrations checks (external dependencies expected to fail sometimes), a throwing `ModuleInstance.health()` is a module implementation bug that should surface loudly, not be silently downgraded to a status field                                                |

## Retry / timeout / cancellation

None at this layer. `checkReadiness` makes each check exactly once per
call; a future transport layer or scheduler decides poll frequency and
per-request timeout, matching this package's posture toward every other
boot/status-time component (no built-in retry loop).

## Concurrency guarantees

`checkReadiness` has no shared mutable state of its own — every
dependency (`database`, `migrations`, `coreStack`) is a fresh call each
invocation. `RelayLagRecorder` is the one piece of shared state, and it
is a plain `Map` write per `record()` call and a `Map` copy on
`snapshot()` — safe for the single-threaded Node.js event loop this
package targets; concurrent callers of `record()` from multiple relay
poll rounds simply serialize through the JS execution model, and
`snapshot()` never observes a partially-written entry.

## Performance

`checkLiveness` is synchronous and free. `checkReadiness` makes: one
`SELECT 1` + one `SELECT now()` (parallelized via `Promise.all`), one
`SELECT` against `platform.module_migrations`, optionally one
`countBacklog` query per configured consumer, and optionally one
`coreStack.health()` call (cost depends on how many modules implement
their own I/O in `health()` — out of this component's control). Not
formally benchmarked (pending E04-T13, same posture as every other
platform component).

## Security considerations

Readiness responses must never leak internal detail: `database.status`
is `"failing"`, never the underlying Postgres error message or connection
string (enforced by the `try`/`catch` around `ping()`/`now()`, which
discards the caught error's message). `pendingModules` and consumer names
in `relayLag`/`backlog` are operator-facing configuration (module names,
consumer names registered by trusted application code), never raw
external input.

## Observability

`ReadinessResult` and `LivenessResult` are the caller's own hook for
logging/metrics — this component does not log internally, matching every
other boot/status-time component in this package. See
[outbox-observability.md](outbox-observability.md) for the broader
metrics/logs vocabulary this endpoint partially surfaces without
duplicating (relay lag, backlog).

## Testing

**27 pure unit tests** (domain: 8, application: 19) covering: status
ordering helpers exhaustively; liveness's zero-dependency shape;
readiness's database/clock-skew/migrations dimensions including both
throw-based and threshold-based failure paths; relay-lag thresholds
_and_ the staleness-overrides-a-good-looking-value case explicitly;
backlog thresholds; module-health folding into the overall worst-of
calculation; and `RelayLagRecorder`'s recording/snapshot/callback-binding
behavior. **8 real-Postgres integration tests** (via the dual-mode
test-database bootstrap) proving `PostgresDatabasePing` against a real
connection (including a closed-connection failure case),
`PostgresMigrationsStatus` against real `platform.module_migrations`
rows, and `PostgresOutboxRelayStore.countBacklog` across the
no-checkpoint / partial-progress / fully-caught-up cases — the same
scenario shape T03's partition-maintenance tests already established for
checkpoint safety.

## Design rationale

Why small, separate port interfaces (`DatabasePingPort`,
`MigrationsStatusPort`, `BacklogCheckPort`) instead of one large
`ReadinessInfrastructure` interface? Each dimension has an independent
optional-vs-required story (`relayLag`/`backlog`/`coreStack` are all
optional on `ReadinessDeps`; `database`/`migrations` are required) — a
single combined interface would force every caller to either implement
every dimension or pass an awkward partial object. Small ports let a
caller wire exactly the dimensions it has real infrastructure for.

Why does `countBacklog` land as an **optional** member of the
already-shipped `OutboxRelayStore` port rather than a required one? A
required addition to an exported interface is a breaking change for any
existing implementer (including test fakes) — a defined stop condition
for this project. An optional member is additive: existing
implementations remain valid unchanged, and `checkReadiness`'s `backlog`
check is itself optional on `ReadinessDeps`, so a caller whose store
doesn't implement `countBacklog` simply omits the `backlog` dependency
rather than being forced to implement a method it can't.

Why fold `CoreStack.health()` in as an opaque `modules` field rather than
flattening each module's status into `checks`? `checks` are this
component's own system-level dimensions (database, migrations, clock
skew, relay, backlog); module health is a pre-existing, independently
versioned shape (`CoreStackHealth`) from a different task (T21).
Embedding it verbatim under its own key keeps the two contracts
distinguishable and avoids this component silently taking on the job of
redefining what a module's health response looks like.
