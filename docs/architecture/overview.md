# CoreStack Architecture Overview

CoreStack is a **modular monolith**: a single deployable composed of independently
versioned modules, each owning one bounded context (auth, tenancy, billing, …).
Modules are npm packages under `packages/`, published under the `@corestack/*` scope.

The decisions summarized here are recorded individually in [../adr/](../adr/).

## The dependency rule

Every module is layered the same way, and **source dependencies only point inward**:

```
┌────────────────────────────────────────────────────────┐
│ interface     HTTP handlers, CLI commands, jobs        │
│   │                                                    │
│   ▼                                                    │
│ application   use cases, ports (interfaces), DTOs      │
│   │                                                    │
│   ▼                                                    │
│ domain        entities, value objects, domain events,  │
│               invariants — zero external dependencies  │
│   ▲                                                    │
│   │ implements ports                                   │
│ infrastructure  Postgres repos, email, Stripe, queues  │
└────────────────────────────────────────────────────────┘
```

- **domain** knows nothing about databases, HTTP, or other modules' internals.
- **application** orchestrates domain objects behind _ports_ — plain TypeScript
  interfaces such as `UserRepository` or `MailSender`.
- **infrastructure** provides adapters that implement those ports (e.g.
  `PostgresUserRepository`). Swapping Postgres for another store means writing a new
  adapter, not touching use cases.
- **interface** translates transport concerns (HTTP, CLI, queue messages) into use
  case invocations. It never contains business rules.

## Cross-module communication

Modules never import each other's domain internals. They interact through:

1. **Public application APIs** — the use cases a module exports.
2. **Domain events** — published on an in-process event bus port; e.g. `tenancy`
   emits `member.removed`, `audit` subscribes. This keeps modules decoupled and makes
   the eventual extraction of a module into a service a mechanical change, not a
   redesign.

## The kernel

`@corestack/kernel` is the one shared dependency every module may use. It contains
only cross-cutting building blocks with no business meaning:

- `Result<T, E>` — explicit, typed error handling for expected failures
- The `CoreError` taxonomy — stable error codes that map cleanly to transport errors
- Ports for ambient effects: `Clock`, `IdGenerator`
- (next) `EventBus` port and domain event contracts

The kernel must stay small. If something in it starts to acquire business meaning,
it belongs in a module instead.

## Error handling convention

- **Expected failures** (validation, not-found, conflicts, permission denials) are
  values: use cases return `Result<T, CoreError>`. Callers must handle them; the
  type system enforces it.
- **Unexpected failures** (bugs, infrastructure outages) throw. They are caught at
  the interface boundary, logged, and mapped to a generic 500-class response — never
  leaked to clients.

## Security posture

- Multi-tenancy isolation is enforced in the application layer on every query path;
  tenant id is part of every repository port method that touches tenant-owned data.
- Secrets and tokens are stored hashed; raw values exist only in memory at issuance.
- All input crossing a trust boundary is validated with Zod schemas before it
  reaches a use case.

## Repository layout

```
packages/          @corestack/* modules (kernel, auth, tenancy, …)
apps/              reference applications (planned: Next.js starter)
docs/adr/          Architecture Decision Records
docs/architecture/ this document and deeper design notes
```
