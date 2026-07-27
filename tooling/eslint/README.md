# @corestack/eslint-config

The repository's shared ESLint flat config — correctness rules only (Prettier
owns formatting). Its centerpiece is machine enforcement of the Clean
Architecture dependency rule ([Architecture §4](../../docs/architecture/ARCHITECTURE.md):
"enforced by tooling, not vigilance"). Every rule below is covered by fixture
tests in [`test/boundaries.test.mjs`](test/boundaries.test.mjs).

## Layer-boundary zones

| Zone (files)                    | Forbidden imports                                                        | Why                                                           |
| ------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `packages/*/src/domain/**`      | `**/application/**`, `**/infrastructure/**`, `**/interface/**`, `node:*` | Innermost layer: kernel types + itself only (ADR-0003)        |
| `packages/*/src/application/**` | `**/infrastructure/**`, `**/interface/**`, `node:*`                      | Orchestrates domain behind ports; runtime-agnostic (ADR-0001) |
| `packages/*/src/interface/**`   | `**/infrastructure/**`                                                   | Bindings depend on application ports, never concrete adapters |

`infrastructure/` may import inward freely — that is its job.

## Production-source rules (`packages/*/src/**`)

- **`no-console`** — modules log through the kernel `Logger` port exclusively
  (Architecture §30); stdout writes bypass redaction and correlation.
- **Sensitive-log deny-list** (`no-restricted-syntax`) — credential-bearing
  property names (`password`, `secret`, `token`, `apiKey`, `authorization`,
  `cookie`, …) may not appear in object literals passed to logger-shaped
  calls (`.trace/.debug/.info/.warn/.error/.fatal`). This is a _heuristic
  tripwire_, not the security boundary — the reference Logger adapter's
  redaction serializer is the boundary; this rule catches the mistake at
  review time instead of in production logs. False positives near logging
  code are intended: rename the local variable rather than weakening the
  rule.
- **`no-restricted-globals: process`** — configuration flows through
  validated module config (Architecture §8), never ad-hoc `process.env`
  reads scattered through source.

## Everywhere

`@typescript-eslint` recommended, `consistent-type-imports` (keeps type-only
imports erasable under `verbatimModuleSyntax`), underscore-escape for unused
args. Tests, `tooling/`, and `apps/` get Node globals and may use `console`.

## Extending

Rule changes land here once, propagate everywhere, and require a fixture test
in the same PR — an unenforced-by-test rule is a rule that will silently rot.
Security-sensitive changes to this package route through the security
rotation (CODEOWNERS).
