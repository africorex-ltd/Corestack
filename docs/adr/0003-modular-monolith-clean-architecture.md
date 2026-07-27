# ADR 0003: Modular monolith with Clean Architecture layering

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

CoreStack must (a) let adopters use one module or all of them, (b) let them swap
infrastructure (database, mail, payments) without forking, and (c) stay maintainable
as the number of modules grows. The classic failure modes are the tangled monolith
(everything imports everything) and premature microservices (operational complexity
before product-market fit — for us, before API stability).

## Decision

- CoreStack is a **modular monolith**. Each bounded context (auth, tenancy, rbac,
  billing, audit, …) is one package with its own domain model.
- Every module uses the same four layers — `domain`, `application`,
  `infrastructure`, `interface` — with the **dependency rule**: source dependencies
  point inward only. Ports (interfaces) live in `application`; adapters live in
  `infrastructure`.
- Modules communicate only via public application APIs and **domain events** on an
  event bus port — never by importing another module's domain or infrastructure.
- Domain and application layers are **framework- and I/O-free**: no Node builtins,
  no HTTP types, no ORM types. Ambient effects (time, ids, events) come in through
  kernel ports.

## Alternatives considered

- **Microservices:** rejected now; the event-driven module boundaries keep later
  extraction mechanical if an adopter needs it.
- **Transaction-script / framework-coupled design (à la classic Rails/Laravel):**
  faster to write, but adopters could never swap infrastructure, and business rules
  would smear across controllers. Contradicts the platform's core promise.

## Consequences

- Some ceremony per module (ports, adapters, mappers). Accepted: this is the cost of
  the swap-anything guarantee.
- Testing is cheap where it matters: domain/application tests run without I/O.
- The dependency rule is enforceable by lint tooling (planned: eslint boundary
  rules) and reviewed in every PR.
