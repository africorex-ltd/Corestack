# ADR 0012: REST-only core API; GraphQL stays a community binding

- **Status:** Accepted
- **Date:** 2026-07-28
- **Elaborated in:** [Architecture §26–27](../architecture/ARCHITECTURE.md), [API §1–2](../architecture/API.md)

## Context

The HTTP surface is command-heavy (use cases), security-critical, and must be
maintainable by a small team. Every parallel API style doubles the
authorization, validation, and documentation surface.

## Decision

The core ships REST only: resource-oriented JSON, RFC 9457 errors with a
stable code registry, cursor pagination, URL major versioning (`/v1`),
OpenAPI 3.1 generated from the runtime Zod schemas. GraphQL is architecturally
possible as a community binding (use cases are transport-agnostic) but is not
a core maintenance commitment.

## Alternatives considered

- **GraphQL in core:** per-field authorization, complexity limiting, and
  resolver N+1 discipline duplicate exactly the security-sensitive machinery
  REST already carries; the generated typed SDK delivers the DX benefit.

## Consequences

One API surface to harden and freeze; SDK generation from one spec; a future
GraphQL decision requires a superseding ADR, not endpoint creep.
