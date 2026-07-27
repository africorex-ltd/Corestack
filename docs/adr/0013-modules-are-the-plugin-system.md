# ADR 0013: Modules are the plugin system; no dynamic runtime loading

- **Status:** Accepted
- **Date:** 2026-07-28
- **Elaborated in:** [Architecture §24](../architecture/ARCHITECTURE.md), [Database §13](../architecture/DATABASE.md), [API §11](../architecture/API.md)

## Context

Extensibility is a core promise, but marketplace-style runtime plugin
installation is a security and stability tax: unreviewed code paths, dynamic
configuration drift, supply-chain opacity.

## Decision

The extension surface is the platform's own construction set: **adapters**
(implement a port, pass its contract suite), **event consumers**,
**third-party modules** (full lifecycle contract, own Postgres schema, routes
under `/x/{moduleKey}`), and documented **use-case decoration**. Plugins are
npm dependencies wired in the composition root — statically typed, reviewed,
version-locked, scannable. There are no plugin registry tables, no plugin
management API, no runtime loading.

**Reconciliation note (2026-07-28):** a later scaffold prompt requested
`packages/plugins` and a plugin management surface; superseded by this ADR
per the founder's reconciliation directive.

## Alternatives considered

- **Dynamic plugin loading + registry:** remote-code-execution-as-a-feature;
  rejected. Discovery/marketplace (Vision §15) is a docs/registry concern,
  not a runtime one.

## Consequences

Third-party modules are indistinguishable from core in tooling; installation
is an npm + composition-root change with a deploy — deliberate, not magical.
