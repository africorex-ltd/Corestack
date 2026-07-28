# @corestack/architecture-tests

> **Private, never published.** The permanent architecture fitness suite
> (Platform Maturity Mode governance §7.1–7.2) — runs in the standard `test`
> lane on every PR, alongside every other package.

## What this package is

Machine enforcement of the rules the design docs state in prose: the
dependency rule (Architecture §4), no import cycles, no cross-package
boundary violations, and mechanical ADR/manifest compliance (MIT license,
`engines`, `exports` hygiene, the kernel's zero-runtime-dependency
guarantee). If a rule can be checked by reading source text instead of by
trusting a PR reviewer's memory, it belongs here.

## Architecture overview

```
test/
  helpers.mjs           workspace-walking + import-extraction utilities (zero deps)
  cycles.test.mjs        no circular imports within any package's src/
  cross-package.test.mjs no deep-imports/relative-escapes; cross-module runtime deps limited to the shared bases (kernel, platform — ADR-0016)
  manifest-rules.test.mjs ESM-only, MIT, engines, exports, LICENSE-in-tarball, kernel zero-deps
```

**Zero runtime dependencies, by policy** — a 40-line custom file walker
(`helpers.mjs`) beats adding a dependency to the package whose entire job is
guarding dependencies.

## Public API guide

This package has no importable API — it is a pure test suite, run via
`pnpm test`. Its "API" is the set of invariants it enforces; see the test
file names above for what's covered.

## Example usage

```bash
pnpm --filter @corestack/architecture-tests test
```

Adding a fitness rule: write a new `test/*.test.mjs` using the shared
helpers; no build step, no compilation — the suite runs directly against
repository source with plain Node + Vitest.

## Testing guide

The suite _is_ the tests — there is no separate "testing the fitness suite"
layer. When a rule proves wrong for a legitimate reason (a package needs an
exemption), add the exemption explicitly and narrowly in the relevant test
file, with a one-line comment explaining why — never loosen a rule silently.

## Common pitfalls

- **New packages need a `package.json` to be seen at all** — `helpers.mjs`
  discovers packages by walking `packages/*`, `apps/*`, `tooling/*` for
  directories containing one. A placeholder folder with only a README
  (Architecture §1 skeleton convention) is correctly invisible to this
  suite until real code lands.
- **Import-cycle detection is per-package**, not repo-wide — cross-package
  cycles are structurally impossible given the shared-bases-only dependency
  rule this same suite enforces (ADR-0016), so a separate whole-repo cycle
  check would be redundant.

## Extension points

Any new fitness dimension (public API stability diffing, forbidden-import
denylists beyond the current set, ADR-compliance checks as they become
mechanically checkable) is a new `test/*.test.mjs` file using the same
`workspacePackages()`/`sourceFiles()`/`importsOf()` helpers.

## Design rationale

Why a package instead of a script? Because it needs to run in the standard
`test` lane (turbo task graph, CI truth guards, coverage tooling) exactly
like every other package's tests — a bespoke script would need its own
wiring and would drift from the conventions it's meant to enforce. Why
zero dependencies? The dependency-count budget this suite enforces on
every other package would be hypocritical to skip for itself.

## Architecture Scorecard

| Dimension       | Assessment                                                           |
| --------------- | -------------------------------------------------------------------- |
| Testability     | N/A in the usual sense — this package _is_ the test layer            |
| Maintainability | High — small, single-purpose, zero dependencies                      |
| Complexity      | Low — plain recursion and regex-based import extraction              |
| Documentation   | Complete (this file)                                                 |
| Performance     | Sub-second full run; not benchmark-tracked (not a runtime component) |
| Security        | N/A (dev-time only, never shipped)                                   |
| API stability   | N/A (no public API)                                                  |
