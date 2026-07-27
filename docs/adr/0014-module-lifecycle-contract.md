# ADR 0014: Uniform module lifecycle contract

- **Status:** Accepted
- **Date:** 2026-07-28
- **Elaborated in:** [Architecture §8](../architecture/ARCHITECTURE.md)

## Context

Any-subset composition, uniform tooling (CLI, docs, doctor), and third-party
module parity all require every module to expose the same shape to the
composition root.

## Decision

Every module exports a factory — `create<X>Module(deps, config)` — returning
`{ useCases, eventHandlers, migrations, health }`. Modules never construct
their own infrastructure; adapters are injected. Config is a Zod schema
validated fail-fast at boot (all errors aggregated, secrets by reference).
Hard dependencies are kernel + own ports only; cross-module features degrade
gracefully via events.

## Alternatives considered

- **Decorator-based DI framework (Nest-style):** couples adopters to a
  framework and `experimentalDecorators`; explicit constructor wiring at one
  composition point is plain, typed TypeScript.
- **Per-module ad-hoc setup:** every module inventing its own boot story is
  how platforms become unlearnable; rejected.

## Consequences

`createCoreStack()`, the CLI, and the docs treat all modules — first- and
third-party — identically; the module quality gate (glossary, threat model,
contract suites, migrations, docs) hangs off this contract.
