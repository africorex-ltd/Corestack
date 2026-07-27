# ADR 0004: PostgreSQL as reference persistence, behind repository ports

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

Modules need durable storage with strong consistency (auth sessions, memberships,
billing state are not eventually-consistent data). Adopters must be able to bring
their own database strategy without forking module logic.

## Decision

- Persistence is accessed exclusively through **repository ports** defined in each
  module's application layer (e.g. `SessionRepository`). Domain and application code
  never see SQL, ORM entities, or connection handles.
- **PostgreSQL is the reference implementation** — the adapter CoreStack ships,
  tests against, and documents. Chosen for ubiquity, transactional integrity,
  row-level security options for tenant isolation, and availability on every cloud
  and marketplace (Neon, Supabase, RDS, …).
- The reference adapters will use **Drizzle ORM**: SQL-transparent, no runtime
  code generation, excellent TypeScript inference, and migrations as plain SQL —
  keeping the adapter thin and auditable. (Confirmed when the first persistence
  adapter lands; revisit in its own ADR if Drizzle proves limiting.)

## Alternatives considered

- **Prisma:** great DX, but a heavier runtime and a schema DSL between the adapter
  and the SQL; thin adapters favor transparency.
- **Query builder only (Kysely):** viable fallback; Drizzle adds schema definition
  and migration tooling on top of comparable type safety.
- **Supporting MySQL/SQLite from day one:** deferred. Ports make additional adapters
  possible later without touching module logic; building them now multiplies the
  test matrix before there are users.

## Consequences

- Adopters with a different store implement documented port interfaces.
- Each module owns its schema/migrations; no cross-module foreign keys — references
  across contexts are by id, integrity maintained via events.
