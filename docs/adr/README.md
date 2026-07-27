# Architecture Decision Records

Every foundational or hard-to-reverse decision in CoreStack is recorded here.
ADRs are immutable once accepted; a change of direction gets a _new_ ADR that
supersedes the old one.

| ADR                                                 | Title                                                        | Status   |
| --------------------------------------------------- | ------------------------------------------------------------ | -------- |
| [0001](0001-typescript-on-nodejs.md)                | TypeScript on Node.js, ESM-only                              | Accepted |
| [0002](0002-pnpm-turborepo-monorepo.md)             | pnpm workspaces + Turborepo monorepo                         | Accepted |
| [0003](0003-modular-monolith-clean-architecture.md) | Modular monolith with Clean Architecture layering            | Accepted |
| [0004](0004-postgresql-behind-repository-ports.md)  | PostgreSQL as reference persistence, behind repository ports | Accepted |
| [0005](0005-zod-boundary-validation.md)             | Zod validation at trust boundaries                           | Accepted |
| [0006](0006-mit-license.md)                         | MIT license                                                  | Accepted |

## Writing an ADR

Copy the structure of an existing ADR: **Context** (the forces at play),
**Decision** (what we're doing, stated imperatively), **Alternatives considered**
(what we rejected and why), **Consequences** (what becomes easier/harder).
Number it sequentially and add it to the table above.
