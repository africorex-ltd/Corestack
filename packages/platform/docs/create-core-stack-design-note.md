# Design Note — `createCoreStack()` API Shape

- **Task:** E03-T21, subtask .1 (required before implementation)
- **Constraint:** ADR-0014 explicitly rejects decorator-based DI containers;
  composition is "explicit constructor injection wired at one composition
  point," never reflection or magic wiring.

## The key design decision

`createCoreStack()` does **not** construct modules from raw
`factory + deps + config` triples. If it did, it would need to solve
heterogeneous generic dispatch across modules with unrelated `TDeps`/
`TConfig`/`TUseCases` types — exactly the kind of container machinery
ADR-0014 rejects, and exactly what "explicit, no reflection" is warning
against.

Instead: **the adopter's own composition script calls each module's
factory directly**, plainly, in order — `createAuthModule(kernelDeps,
authAdapters, authConfig)` is one readable line the adopter can step
through in a debugger. `createCoreStack()` receives the **already-built**
`ModuleInstance` objects and does only the cross-cutting wiring that
genuinely needs a single place to happen:

1. **Conformance-check every module** (T20) before wiring anything —
   boot-fails loudly, with every issue from every module aggregated and
   namespaced (`auth.eventHandlers[0].handler`), never a mysterious runtime
   failure three requests later.
2. **Subscribe every module's `eventHandlers` to the one shared `EventBus`**
   the adopter constructed and passed to every module's deps — this is the
   one piece of real "wiring" the name promises.
3. **Detect boot-time mistakes cheap to catch and expensive to debug
   later**: two modules registering the same `(consumer, event)` pair
   (would silently corrupt future outbox checkpoint tracking, T02/T12), and
   a module's own declared `migrations.module` not matching the key it was
   registered under (a copy-paste class of mistake).
4. **Aggregate health** across every module (worst-of: any `unhealthy` wins,
   else any `degraded` wins, else `healthy`) — the one shape T23's
   readiness framework polls.

**Explicitly out of scope for `createCoreStack()`:** loading config (T22
already returns adopter-usable data before any factory is called — the
adopter's script calls `loadAllModuleConfigs` first, then passes the
result into each factory call); constructing the shared kernel ports
(the adopter builds `Clock`/`IdGenerator`/`Logger`/`EventBus`/`UnitOfWork`
themselves — or later versions of `@corestack/cli init` scaffold that
construction, but it is never implicit); graceful shutdown ordering (T24,
a separate concern layered on top of the `CoreStack` handle this function
returns).

## Consequences

- A composition script is fully readable top-to-bottom with no hidden
  control flow: build kernel ports → load configs → call each factory →
  call `createCoreStack()` → (later) start the HTTP binding.
- Adding a module means adding one factory call and one entry in the
  `modules` record — no registry, no decorators, no magic string lookup.
- The type of `modules` is intentionally `Record<string, ModuleInstance>`
  (the generic-erased return type from T20) — `createCoreStack` treats
  every module identically regardless of its specific `TUseCases` shape,
  which is exactly right for cross-cutting wiring that doesn't care what a
  module's use cases actually do.
