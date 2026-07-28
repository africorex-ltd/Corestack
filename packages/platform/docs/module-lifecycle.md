# Component Spec — Module Lifecycle Contract

- **Task:** E03-T20 · **Status:** Implemented · **Category:** APP (application layer, pure — no I/O)
- **ADR references:** ADR-0014 (uniform module lifecycle contract), ADR-0016 (platform as second shared base), ADR-0009 (outbox — `eventHandlers` feeds it)
- **Design docs:** [Architecture §8](../../../docs/architecture/ARCHITECTURE.md) (module lifecycle contract), [Architecture §24](../../../docs/architecture/ARCHITECTURE.md) (third-party modules must satisfy the same contract)

## Contract

**Purpose:** define the one shape every module's factory function must
return, so the composition root (T21), the CLI's `doctor`, and health
aggregation can treat every module — first-party or third-party — the
same way.

**Public surface** (all from `@corestack/platform`):

| Export                                     | Purpose                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `ModuleInstance<TUseCases>`                | The return-type contract: `useCases`, `eventHandlers`, optional `migrations`, `health()` |
| `ModuleFactory<TDeps, TConfig, TUseCases>` | The function-signature contract every module's exported factory matches                  |
| `ModuleHealth` / `ModuleHealthStatus`      | `{ status: "healthy" \| "degraded" \| "unhealthy", details? }`                           |
| `checkModuleConformance(instance)`         | Runtime structural check; returns every issue found (never just the first)               |
| `assertModuleConformance(instance, name)`  | Throws `ValidationError` with all issues in `metadata.issues` if non-conformant          |

## Failure modes

| Failure                                                                                           | Behavior                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Missing/wrong-typed `useCases`, `eventHandlers`, or `health`                                      | Each is its own aggregated issue — a module author (or a broken third-party module) sees everything wrong in one message                   |
| Malformed individual `eventHandlers` entry (missing `consumer`/`event`/`handler`, or wrong types) | Each malformed field is its own issue, scoped by array index (`eventHandlers[2].handler`) — precise enough to fix without guessing         |
| Present but malformed `migrations`                                                                | One issue; a _missing_ `migrations` field is valid (it's optional — not every module owns a schema)                                        |
| Non-object instance entirely (`null`, a string, `undefined`)                                      | One top-level issue (`$`) rather than a crash — the checker never throws on bad input, only `assertModuleConformance` throws, deliberately |

## Retry / timeout / cancellation

None — this is a synchronous, in-memory structural check with no I/O.
Same reasoning as the migration loader's component spec: no failure mode
exists here that retry/timeout machinery would address.

## Concurrency guarantees

Fully pure and stateless; `checkModuleConformance` and
`assertModuleConformance` have no shared state and are trivially safe to
call concurrently for any number of module instances.

## Performance

Negligible — a handful of `typeof`/`Array.isArray` checks per module,
run once at boot per installed module (a fixed, small number). No
benchmark warranted; flagged in the platform package scorecard as "not a
runtime-path component."

## Security considerations

`ModuleHealth.details` is documented as **non-sensitive diagnostic detail
only** — the same rule as kernel's logger fields (never secrets). This
component performs no authorization or tenant-scoping itself; it is a
structural-shape check only, run at boot before a module's use cases ever
see a request.

## Observability

Deliberately none _in this component_ — it runs once per module at boot,
not on a request path. Its entire observability contribution is that a
conformance failure is a `ValidationError` with structured, aggregated
`metadata` — sufficient for the composition root (T21) to log a precise
boot-failure message. Ongoing module health _reporting_ (the actual
observability surface adopters care about) is `ModuleInstance.health()`
itself, which the composition root's readiness framework (T23) will poll
and expose.

## Testing

10 tests: a real `ModuleFactory` built from actual kernel ports (`Clock`,
`IdGenerator`) proving the generic type signature compiles and works
end-to-end; every required-field-missing case; per-field event-subscription
validation; valid/invalid/absent `migrations`; non-object input handling;
and `assertModuleConformance`'s throw behavior with full issue aggregation.

## Design rationale

Why a runtime checker alongside compile-time types at all? Because
TypeScript's structural typing is checked only where the compiler can see
both sides — a third-party module, compiled in its own separate package
with its own `tsconfig`, is never type-checked against CoreStack's
`ModuleInstance` interface at all. The composition root is the one place
that sees every module regardless of where it came from, so it is the one
place a runtime safety net earns its keep. The checker deliberately mirrors
the aggregate-everything convention established by the migration loader
(T01) and the config validation framework (T22) — one convention, applied
consistently, is easier to learn than three different error-reporting
styles across the same package.
