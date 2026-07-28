# Component Spec — Config Validation Framework

- **Task:** E03-T22 · **Status:** Implemented · **Category:** APP (application layer, no I/O beyond the injected `EnvSource`/`SecretResolver`)
- **ADR references:** ADR-0005 (Zod at trust boundaries — the first non-adopter-facing use: environment configuration is external input too), ADR-0014 (module lifecycle: config is part of every module's factory signature)
- **Design docs:** [Architecture §8](../../../docs/architecture/ARCHITECTURE.md) ("Config is a Zod schema validated fail-fast at boot — all errors aggregated, secrets by reference")

## Contract

**Purpose:** validate every module's configuration from environment
variables, in one pass, reporting every problem across every module
together — never fail-fast on the first broken field or the first broken
module.

**Public surface** (all from `@corestack/platform`):

| Export                                                  | Purpose                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ModuleConfigSpec<T>`                                   | `{ moduleName, schema: ZodType<T>, envMapping }` — one module's config contract                                 |
| `ModuleConfigEnvMapping`                                | Field name → env var name, optionally `{ envKey, secret: true }`                                                |
| `loadModuleConfig(spec, env, secretResolver?)`          | Loads and validates one module's config → `Result<T, ConfigValidationIssue[]>`                                  |
| `loadAllModuleConfigs({ specs, env, secretResolver? })` | Validates every module together → `Result<Record<string, unknown>, ValidationError>` with all issues aggregated |
| `EnvSource` / `SecretResolver` (ports)                  | `get(key)` / `resolve(ref)` — swappable sources                                                                 |
| `ProcessEnvSource`                                      | Reference `EnvSource`: wraps `process.env`                                                                      |
| `isSecretRefValue` / `stripSecretRefPrefix` (domain)    | Pure `ref:...` syntax helpers                                                                                   |

**Scope, deliberately:** flat, env-var-sourced config only (env vars are
inherently flat; a module needing nested shape post-processes after
loading its own flat fields — this framework does not invent a config
file format).

## Failure modes

| Failure                                           | Behavior                                                                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing required field                            | Zod reports it; issue carries `field` + `envKey`, no value                                                                                                                                                |
| Wrong type / failed validation rule               | One issue per failing field, from Zod's own aggregated `safeParse` (Zod already reports every field problem, not just the first — this framework doesn't need to re-implement that)                       |
| `ref:` secret with no `SecretResolver` configured | One issue, resolver never called                                                                                                                                                                          |
| `SecretResolver.resolve()` throws                 | One issue wrapping the resolver's error message (the _reference locator_ may appear — e.g. "no secret registered for ref X" — but never the secret's actual value, which the resolver never returned)     |
| A field's resolution already failed               | The corresponding Zod "missing/invalid" issue for that _same_ field is suppressed — one root cause produces one issue, not two confusing ones (caught by a failing test before this shipped, see Testing) |
| Any module fails                                  | **All-or-nothing**: `loadAllModuleConfigs` returns `Err` if _any_ module has _any_ issue; no partial config is ever returned, so a caller can never accidentally boot half-configured                     |

## Retry / timeout / cancellation

None from this framework itself — `EnvSource.get` is synchronous and local.
A real `SecretResolver` adapter talking to a network secret manager (Vault,
AWS Secrets Manager) is where retry/timeout belong, scoped to that
adapter's actual network risk; this framework's contract with
`SecretResolver` is intentionally just `resolve(ref): Promise<string>`,
leaving resilience entirely to the adapter.

## Concurrency guarantees

Pure with respect to the framework's own state (no caching, no shared
mutable state); `loadModuleConfig` calls are independent and safe to run
concurrently. `loadAllModuleConfigs` currently awaits modules sequentially
(config loading happens once at boot; sequential is simpler to reason
about and the cost is negligible at realistic module counts).

## Performance

Negligible — a handful of env lookups and one `safeParse` per module, once
at boot. Not benchmark-tracked (not a runtime-path component, same
reasoning as the module lifecycle checker).

## Security considerations — the load-bearing section for this component

- **No config value ever appears in an issue** — not the raw env value,
  not the resolved secret, not even for non-secret fields. Issues describe
  _what rule failed_, never _what value failed it_.
- **Zod's own messages are redacted for secret fields.** Some Zod issue
  types (`enum`, `literal`) embed the received value directly in their
  message text (`"received 'x'"`). Passing that through unmodified for a
  secret field would leak the secret through a code path this framework
  doesn't directly control — caught during test-writing (not after
  shipping) and fixed by redacting the message whenever the failing
  field is marked `secret`, at the cost of a less specific error for
  secret fields (an acceptable, deliberate trade: "value is invalid" beats
  a leaked credential).
- **`ref:` indirection is opt-in per field**, not global — a non-secret
  field whose literal value happens to start with `ref:` is used as-is.
  This is a documented, tested behavior (not an oversight): treating every
  `ref:`-prefixed string specially, platform-wide, would be surprising
  action-at-a-distance for fields that were never meant to be resolved.

## Observability

Deliberately none in this component (boot-time, not request-path) — same
reasoning as the migration loader and module lifecycle contract. Failure
is a `ValidationError` with structured `metadata.issues`, sufficient for
the composition root (T21) to produce one precise boot-failure log line
listing everything wrong.

## Testing

65 platform tests total; this component contributes 12 (config-validation)

- 2 (secret-ref) + 2 (`ProcessEnvSource`) = 16. Covers: happy path,
  missing-field, multi-field aggregation within one module, secret
  resolution success/no-resolver/resolver-failure, the
  literal-vs-reference distinction for non-secret fields, the Zod-message
  redaction for secret fields (and its _absence_ for non-secret fields, to
  prove the redaction is scoped correctly), and `loadAllModuleConfigs`'
  all-or-nothing, cross-module aggregation behavior.

## Design rationale

Why Zod specifically, and why redact rather than sanitize the message
text? Redaction (replace entirely) was chosen over attempting to scrub
values out of arbitrary upstream library message strings — string-scrubbing
is a losing game against a message format this framework doesn't control
and Zod could change at any version bump; an outright replacement is the
only approach that's actually guaranteed safe. Why aggregate everything
instead of stopping at the first module? Because the whole point of a
"never fail-fast" convention (already established by the migration loader,
T01) is that an operator debugging a broken deployment wants the complete
list on the first try, not a slow reveal across N restarts.
