# ADR 0008: Pooled multi-tenancy with layered enforcement

- **Status:** Accepted
- **Date:** 2026-07-28
- **Elaborated in:** [Architecture §20](../architecture/ARCHITECTURE.md), [Database §15](../architecture/DATABASE.md)

## Context

Tenant isolation is the platform's most safety-critical property. The tenancy
model determines operational cost, scalability, and the isolation mechanism.

## Decision

**Pooled model:** shared database, shared schema, `organization_id`
discriminator on every tenant-owned table — enforced in four layers:
(1) repository port signatures structurally require the org id;
(2) request `Context` carries the server-resolved org (never client-asserted);
(3) Postgres RLS as defense-in-depth backstop;
(4) an unskippable cross-tenant isolation test suite in CI.

## Alternatives considered

- **Schema-per-tenant:** migration fan-out and connection-pool fragmentation
  at scale; rejected as default.
- **Database-per-tenant:** operational cost incompatible with "Node + Postgres
  is enough"; documented as an adopter option via custom adapters (ports don't
  assume pooling).

## Consequences

Thousands of tenants with zero per-tenant operations; a missed application
check degrades to an RLS-caught failure, not a breach; org-id-everywhere
discipline keeps later sharding feasible.
