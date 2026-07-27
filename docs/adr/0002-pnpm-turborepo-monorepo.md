# ADR 0002: pnpm workspaces + Turborepo monorepo

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

CoreStack is a family of independently versioned packages (`@corestack/kernel`,
`@corestack/auth`, …) plus reference apps. They must be developed together (atomic
cross-package changes, one CI) but consumed separately.

## Decision

- A single monorepo using **pnpm workspaces** for dependency management and
  **Turborepo** for task orchestration and caching.
- Layout: `packages/*` for publishable modules, `apps/*` for reference applications.
- Workspace packages reference each other with the `workspace:` protocol.

## Alternatives considered

- **npm/yarn workspaces:** slower installs, no content-addressed store; pnpm's
  strictness (no phantom dependencies) matters for a platform whose packages must
  declare honest dependency graphs.
- **Nx:** more powerful but heavier and more opinionated; Turborepo's task-graph +
  cache is all we need.
- **Polyrepo:** atomic changes across module boundaries become multi-repo PR chains;
  rejected for a young platform whose module APIs are still settling.

## Consequences

- One `pnpm install`, one CI pipeline, cached `build`/`test`/`typecheck` via turbo.
- Contributors need pnpm (enforced via `packageManager` field).
