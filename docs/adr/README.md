# Architecture Decision Records

Every foundational or hard-to-reverse decision in CoreStack is recorded here.
ADRs are immutable once accepted; a change of direction gets a _new_ ADR that
supersedes the old one.

| ADR                                                              | Title                                                         | Status   |
| ---------------------------------------------------------------- | ------------------------------------------------------------- | -------- |
| [0001](0001-typescript-on-nodejs.md)                             | TypeScript on Node.js, ESM-only                               | Accepted |
| [0002](0002-pnpm-turborepo-monorepo.md)                          | pnpm workspaces + Turborepo monorepo                          | Accepted |
| [0003](0003-modular-monolith-clean-architecture.md)              | Modular monolith with Clean Architecture layering             | Accepted |
| [0004](0004-postgresql-behind-repository-ports.md)               | PostgreSQL as reference persistence, behind repository ports  | Accepted |
| [0005](0005-zod-boundary-validation.md)                          | Zod validation at trust boundaries                            | Accepted |
| [0006](0006-mit-license.md)                                      | MIT license                                                   | Accepted |
| [0007](0007-opaque-server-side-sessions.md)                      | Opaque server-side sessions, not stateless JWTs               | Accepted |
| [0008](0008-pooled-multi-tenancy.md)                             | Pooled multi-tenancy with layered enforcement                 | Accepted |
| [0009](0009-transactional-outbox-no-event-sourcing.md)           | Transactional outbox for events; no event sourcing            | Accepted |
| [0010](0010-adapters-as-subpath-exports.md)                      | Reference adapters as subpath exports                         | Accepted |
| [0011](0011-postgres-backed-queue-default.md)                    | Postgres-backed job queue as reference default                | Accepted |
| [0012](0012-rest-only-core-api.md)                               | REST-only core API; GraphQL as community binding              | Accepted |
| [0013](0013-modules-are-the-plugin-system.md)                    | Modules are the plugin system; no runtime loading             | Accepted |
| [0014](0014-module-lifecycle-contract.md)                        | Uniform module lifecycle contract                             | Accepted |
| [0015](0015-zero-downtime-upgrade-contract.md)                   | Zero-downtime N/N+1 upgrade contract                          | Accepted |
| [0016](0016-platform-as-second-shared-base.md)                   | `@corestack/platform` is a second shared dependency base      | Accepted |
| [0017](0017-drizzle-deferred-to-first-module-repository.md)      | Drizzle deferred to the first module repository adapter       | Accepted |
| [0018](0018-cache-no-postgres-backend-redis-deferred.md)         | No Postgres-backed cache; Redis `CachePort` adapter deferred  | Accepted |
| [0019](0019-idempotencystore-added-to-kernel.md)                 | `IdempotencyStore` added to the kernel (E03-T43 prerequisite) | Accepted |
| [0020](0020-idempotencystore-organizationid-mandatory.md)        | `IdempotencyStore.begin`/`complete` require `organizationId`  | Accepted |
| [0021](0021-globalrepository-marker-and-tenant-fitness-rules.md) | `GlobalRepository` marker + tenant-isolation fitness rules    | Accepted |
| [0022](0022-logger-runtime-redaction-and-error-serialization.md) | `Logger` adapters must redact sensitive fields + serialize errors | Accepted |
| [0023](0023-tenancy-schema-text-enum-with-check-constraint.md)   | Tenancy schema enums are CHECK-constrained `text`, not native Postgres `ENUM` | Accepted |
| [0024](0024-tenancy-organizations-rls-direct-visibility.md)      | `tenancy.organizations`' RLS uses direct (id-keyed) visibility, not membership-driven | Accepted |
| [0025](0025-organization-save-sets-own-org-context.md)           | `PostgresOrganizationRepository.save` sets its own `app.current_org`, not `PostgresUnitOfWork`'s constructor | Accepted |

## Writing an ADR

Copy the structure of an existing ADR: **Context** (the forces at play),
**Decision** (what we're doing, stated imperatively), **Alternatives considered**
(what we rejected and why), **Consequences** (what becomes easier/harder).
Number it sequentially and add it to the table above.
