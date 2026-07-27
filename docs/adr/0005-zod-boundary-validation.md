# ADR 0005: Zod validation at trust boundaries

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

Security by default requires that no unvalidated input reaches a use case. We need
one validation approach shared by every module so adopters learn it once, with
static types derived from the same source of truth as the runtime checks.

## Decision

- **Zod** schemas validate all data crossing a trust boundary: HTTP payloads, queue
  messages, webhook bodies, environment configuration.
- Schemas live in the module's `interface`/`application` boundary and derive the DTO
  types used by use cases (`z.infer`) — types and validation cannot drift apart.
- Validation failures surface as the kernel's `ValidationError` with structured
  issue metadata; they never throw raw Zod errors across layer boundaries.
- The **domain layer does not use Zod**. Domain invariants are enforced by
  constructors/factories of entities and value objects — invariants are business
  rules, not input parsing.

## Alternatives considered

- **Valibot / ArkType:** smaller or faster, but Zod's ecosystem (OpenAPI generators,
  framework integrations) and familiarity win for a platform optimizing adopter DX.
- **class-validator + decorators:** couples validation to class instances and
  `experimentalDecorators`; rejected.

## Consequences

- Zod is a peer dependency of modules' interface layers — the single deliberate
  exception to "domain/application depend on nothing external".
- OpenAPI documentation can be generated from the same schemas later.
