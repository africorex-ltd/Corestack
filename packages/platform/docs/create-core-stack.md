# Component Spec — `createCoreStack()` Composition Helper

- **Task:** E03-T21 · **Status:** Implemented · **Category:** APP (application layer, no I/O)
- **ADR references:** ADR-0014 (module lifecycle contract; explicit composition, no DI container), ADR-0009 (outbox — the duplicate-consumer check protects future checkpoint integrity)
- **Design note:** [docs/create-core-stack-design-note.md](create-core-stack-design-note.md) (subtask .1, written before implementation)

## Contract

**Purpose:** wire already-constructed `ModuleInstance`s (built by the
adopter's own composition script calling each module's factory directly)
into one `CoreStack`: conformance-verified, event-bus-subscribed,
health-aggregated.

**Public surface:**

| Export                                   | Purpose                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `createCoreStack({ eventBus, modules })` | The one composition call; throws or returns a `CoreStack`                |
| `CoreStack`                              | `{ modules, health() }`                                                  |
| `CoreStackHealth`                        | `{ status, modules: Record<name, ModuleHealth> }` — worst-of aggregation |

**Explicitly not this function's job** (see the design note): constructing
modules from factory+deps+config, loading config, constructing the shared
kernel ports, or graceful shutdown ordering (T24).

## Failure modes

| Failure                                                           | Behavior                                                                                                                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any module fails `checkModuleConformance` (T20)                   | Boot-fails with `ValidationError`; every issue from every module namespaced by module name (`auth.eventHandlers[0].handler`)                                                        |
| Two modules register the same `(consumer, event)` pair            | Boot-fails — a real future risk: the outbox relay's checkpoint tracking (T02/T12) is keyed by consumer name, so a silent collision would corrupt delivery guarantees across modules |
| A module's `migrations.module` doesn't match its registration key | Boot-fails — catches a copy-paste class of mistake before it causes a module to apply the wrong schema                                                                              |
| A module's `health()` throws                                      | **Not caught here** — deliberately propagates; a throwing health check is itself a bug the caller should see immediately, not a "degraded" status to paper over                     |

**Ordering matters, and was itself a caught bug:** composition-level checks
(duplicate consumer/event, migrations-key match) assume every instance is
already structurally sound — iterating a malformed module's missing
`eventHandlers` crashed with a raw `TypeError` before the conformance
check's aggregated `ValidationError` ever ran. Fixed by only running
composition-level checks once every module has individually passed
conformance; a dedicated regression test locks this ordering in.

## Retry / timeout / cancellation

None — this is synchronous wiring logic (aside from awaiting each module's
`health()`), run once at boot. `health()` itself does not time out a slow
module's check; a module whose own `health()` is I/O-bound (e.g. a DB
ping) owns its own timeout internally — `createCoreStack` doesn't second-
guess a module's self-reported status.

## Concurrency guarantees

`createCoreStack()` itself is called once, synchronously, at boot — no
concurrency concern. `health()` may be called concurrently and repeatedly
(e.g. by an HTTP readiness endpoint under load); it has no shared mutable
state and awaits each module's own `health()` independently via
`Promise.all`.

## Performance

Boot-time cost is proportional to module count × their `eventHandlers`
length — negligible for realistic module counts (tens, not thousands).
`health()`'s cost is dominated by whatever the slowest module's own health
check does; this component adds only a `Promise.all` and a status
comparison on top.

## Security considerations

No authorization or tenant-scoping — this is boot-time internal wiring
with no request context. `CoreStackHealth.modules[x].details` inherits the
same "non-sensitive diagnostic data only" rule as `ModuleHealth` itself.

## Observability

The boot-fail path _is_ the observability surface here: a single,
structured `ValidationError` with every problem aggregated is what a
future `corestack doctor` or composition-root log line surfaces. Ongoing
health is `CoreStack.health()` — T23's readiness framework polls this
directly; no separate metrics/tracing are added in this component (the
individual modules' own instrumentation is where real signal lives).

## Testing

12 tests: the task's own AC scenario (boots with two fake modules); event-
bus subscription actually delivering to both modules; the conformance
boot-fail path with correct module-namespaced aggregation; **the ordering
regression** (malformed module → `ValidationError`, never a raw
`TypeError`); duplicate-consumer detection (and its negative — same
consumer, different event, no collision); `migrations.module` mismatch
detection (and its negative); and the full `health()` matrix (all-healthy,
worst-of unhealthy, worst-of degraded, async health functions).

## Design rationale

See the [design note](create-core-stack-design-note.md) for the core
decision (no DI container, adopter calls factories explicitly). The
narrower rationale for the _composition-level_ checks specifically: they
exist because these are exactly the class of mistake that "explicit, no
reflection" composition can still make — a copy-pasted registration key, a
consumer name collision across two independently-written modules — and
that are cheap to catch at boot and expensive to debug as a production
incident three weeks later.
