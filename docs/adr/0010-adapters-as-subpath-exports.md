# ADR 0010: Reference adapters ship as subpath exports of their module

- **Status:** Accepted
- **Date:** 2026-07-28
- **Elaborated in:** [Architecture §7](../architecture/ARCHITECTURE.md)

## Context

Reference adapters (Postgres repositories, Stripe gateway, Hono binding) must
version in lockstep with their module's ports, and adopters must be able to
install the pure core with zero infrastructure dependencies.

## Decision

Reference adapters live **inside the module package under subpath exports**
(`@corestack/auth/postgres`, `@corestack/auth/hono`), with vendor SDKs as
**optional peer dependencies** installed only by adopters using that subpath.
Community adapters live in their own packages against the documented port
contracts and published contract-test suites.

## Alternatives considered

- **Separate adapter packages per module:** a version-compatibility matrix
  (`auth@1.2` × `auth-postgres@?`) for adopters and triple release overhead;
  rejected.

## Consequences

Core and adapter cannot drift; the `exports` map keeps the pure core
dependency-free; the semver perimeter is exactly what the exports map exposes.
