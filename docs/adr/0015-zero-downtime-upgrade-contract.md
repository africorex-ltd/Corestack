# ADR 0015: Zero-downtime N/N+1 upgrade contract

- **Status:** Accepted
- **Date:** 2026-07-28
- **Elaborated in:** [Architecture §36](../architecture/ARCHITECTURE.md), [Database §18](../architecture/DATABASE.md)

## Context

"Upgrades, not forks" is only real if upgrading is safe in production.
Adopters run rolling deploys; old code briefly runs against new schema on
every release.

## Decision

Every release is **N/N+1 compatible**: version N's code runs correctly
against version N+1's schema. Migrations follow expand-and-contract
(add-nullable → backfill separately → enforce → contract across ≥ 2
releases); the documented deploy order is migrate-then-deploy. Post-M5 this
contract is CI-enforced: the previous minor's test suite runs against the
current schema on every release, and the lane cannot be skipped.

## Alternatives considered

- **Maintenance-window upgrades:** pushes operational risk onto every
  adopter forever to save ourselves migration discipline; rejected.

## Consequences

Some schema changes take two releases; in exchange, every CoreStack upgrade
is a boring rolling deploy — which is the entire brand.
