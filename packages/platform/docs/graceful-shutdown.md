# Component Spec — Graceful Shutdown Orchestration

- **Task:** E03-T24 · **Status:** Implemented · **Category:** APP (application layer, no I/O)
- **ADR references:** none directly; implements Architecture §36's deploy-order contract at the process level
- **Design docs:** [Architecture §36](../../../docs/architecture/ARCHITECTURE.md) ("SIGTERM: stop intake → drain relay/jobs → close pools; ordered, bounded by timeout")

## Contract

**Purpose:** orchestrate an ordered, timeout-bounded shutdown sequence
over a set of registered `Drainable` components — generic over _what_ is
draining (HTTP listener, outbox relay, job queue, connection pool); this
component only knows the _order and bounding_ discipline.

**Public surface:**

| Export                                                        | Purpose                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Drainable`                                                   | `{ name, stopIntake(), drain() }` — the port every drainable resource implements |
| `shutdownGracefully({ drainables, drainTimeoutMs, logger? })` | Runs the full sequence; **never throws**                                         |
| `ShutdownReport`                                              | `{ outcomes, clean }` — one outcome per drainable                                |
| `ShutdownOutcome`                                             | `drained \| timed_out \| failed` per component                                   |

## Failure modes

| Failure                                | Behavior                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A drainable's `stopIntake()` throws    | Logged as a warning; **never blocks** subsequent stop-intake calls or any draining — refusing to shut down because one listener failed to unbind would be worse than proceeding |
| A drainable's `drain()` throws         | Captured as a `failed` outcome with the original error attached; the _next_ drainable still runs                                                                                |
| A drainable's `drain()` never resolves | Bounded by `drainTimeoutMs`; captured as `timed_out`; the _next_ drainable still runs — one stuck component can never hang the whole shutdown                                   |
| Every component fails or times out     | `shutdownGracefully` still resolves normally with `clean: false` — the function's own contract is "never throws," full stop                                                     |

## Retry / timeout / cancellation

**Timeout is the core feature**, not an afterthought: every `drain()` call
is raced against `drainTimeoutMs` via a minimal `Promise.race`-style
wrapper (`withTimeout`), with no retry (a shutdown sequence retrying a
stuck resource is exactly backwards — the goal is to finish shutting down,
not to keep trying the thing that's stuck). No cancellation signal is
threaded into `drain()` itself in this version — a timed-out drain's
promise is abandoned, not aborted; a future version could accept an
`AbortSignal` per drainable if a real resource needs to react to timeout
by force-closing rather than merely being ignored.

## Concurrency guarantees

Deliberately **sequential, not parallel** — this is the point of "ordered"
in the task description: stop-intake runs for every component before any
draining begins (so nothing new arrives mid-drain), and drains run one at
a time in registration order (so, e.g., an HTTP listener finishes before
the database pool it depends on closes). Parallelizing drains would be a
plausible future optimization but would break the ordering guarantee this
component exists to provide.

## Performance

Total shutdown time is bounded by
`sum(each drainable's actual drain time, capped at drainTimeoutMs)` —
callers size `drainTimeoutMs` against their platform's SIGTERM grace
period (e.g. Kubernetes' `terminationGracePeriodSeconds`).

## Security considerations

None specific — internal process lifecycle orchestration, no request
context, no untrusted input (drainables are registered by the adopter's
own composition code).

## Observability

Every phase transition is logged via the kernel `Logger` port (optional —
`logger` may be omitted, e.g. in tests): stop-intake failures as warnings,
successful drains as info, timeouts and failures as warnings. The returned
`ShutdownReport` is the structured, programmatic observability surface —
an adopter can alert on `clean: false` or inspect individual outcomes.

## Testing

8 tests: sequential drain order proven with a slow-then-fast pair (not
just "both ran," but the actual interleaving of start/end events);
stop-intake-before-any-drain proven the same way; the timeout bound
(a permanently-stuck `drain()` is captured as `timed_out`, and the next
component still runs); thrown-error capture (same "continue anyway"
behavior); a failing `stopIntake` logged but non-blocking; the
"never throws" guarantee under total failure; and the trivial empty-list
case.

## Design rationale

Why sequential rather than parallel, given parallel would often be faster?
Because shutdown order frequently encodes real dependencies (drain the
HTTP listener — stop taking requests — _before_ draining the outbox relay
those requests fed, _before_ closing the database pool the relay reads
from). A generic orchestrator cannot know which orderings are safe to
parallelize without dependency metadata this version doesn't have; the
conservative, correct-by-construction default is strict registration
order, with parallelization as a documented future option once (if) a
real need for it appears — not built speculatively now.
