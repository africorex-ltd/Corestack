# `@corestack/tenancy`

Organizations, memberships, and invitations — the platform's unit of
tenancy. Every other module scopes tenant-owned data to this context's
`Organization` aggregate; billing bills it, rbac scopes to it, audit
partitions by it. Deliberately one fused context — splitting organizations
from tenants is the classic irreversible SaaS-starter mistake.

Design: [Architecture §6, §19–20](../../docs/architecture/ARCHITECTURE.md) ·
[Database §5](../../docs/architecture/DATABASE.md) ·
[API §5–6](../../docs/architecture/API.md)

Built as **the module scaffold every later module copies** (E05-T01's
acceptance criterion; see Section 10 of
[docs/engineering/e05-readiness-gate-report.md](../../docs/engineering/e05-readiness-gate-report.md)'s
adopted permanent policy). This package resolves the E05 readiness gate's
own top friction-log finding — that no module scaffold generator or
reference existed anywhere in the repo
([docs/engineering/e05-readiness-friction-log.md](../../docs/engineering/e05-readiness-friction-log.md),
step 1).

## Purpose

Tenancy owns three aggregates (per
[docs/modules/tenancy-contract.md](../../docs/modules/tenancy-contract.md)):

- **Organization** — name/slug, `personal`/`team` kind, a
  `active → suspended → pending_deletion → purged` status machine.
- **Membership** — role (`owner`/`admin`/`member`), status, join semantics.
- **Invitation** — email-addressed, single-use hashed token, expiry, a
  "never-owner" rule.

## Architecture

Standard CoreStack module layout — the same Clean Architecture layering
and dependency rule as `@corestack/platform` and
[examples/acme-crm-module](../../examples/acme-crm-module):

```
src/
  domain/          Organization aggregate (E05-T02); Membership/Invitation still placeholders
  application/     repository ports, event contracts, config spec, module factory
  infrastructure/  reserved — Postgres adapters land in E05-T21..T23
  interface/       reserved — HTTP bindings land in E05-T24..T25
  testing/         reserved — adopter-facing fakes land in E05-T28
```

Every module — first-party or third-party — exports one factory,
`createTenancyModule(deps, config) => ModuleInstance`, per the module
lifecycle contract (E03-T20, `@corestack/platform`'s
`ModuleFactory`/`ModuleInstance`/`checkModuleConformance`). The
composition root calls this factory once, injecting adapters it already
constructed; the module never builds its own infrastructure.

## Current status: scaffold (E05-T01) + Organization domain + application (E05-T02/T03)

What exists today:

- **The `createOrganization` use case** — coordinates the `Organization`
  aggregate, `OrganizationRepository`, and `UnitOfWork` event publication;
  contains no domain rules of its own. Returns
  `Result<CreateOrganizationResult, ValidationError | DuplicateSlugError>`
  — a DTO, never the aggregate. Full detail:
  [docs/modules/create-organization-usecase.md](../../docs/modules/create-organization-usecase.md).
  No repository adapter, no SQL, no RLS, no HTTP — this proves the
  domain+application vertical slice with in-memory test doubles only.
- **The `Organization` aggregate** — a pure domain model: `OrganizationId`/
  `OrganizationSlug` value objects, an `OrganizationStatus` enum
  (`ACTIVE`/`SUSPENDED`/`DELETED`, `DELETED` terminal), explicit methods
  (`create`/`rename`/`suspend`/`reactivate`/`delete`), domain events
  collected via `pullDomainEvents()`/`clearDomainEvents()`. No
  persistence, no I/O, no kernel port dependency. Full detail:
  [docs/modules/organization-domain.md](../../docs/modules/organization-domain.md).
  `Membership`/`Invitation` are still bare placeholder record types
  (E05-T03/T04).
- The package itself: manifest, tsconfig, `vitest.config.ts` (the first
  bare one in this repo — see the file's own comment), LICENSE, this
  README.
- `createTenancyModule`: registers a purge subscription and a static
  `health()` stub; returns an empty `useCases: {}`.
- Repository ports (`OrganizationRepository`, `MembershipRepository`,
  `InvitationRepository`) — interfaces only, no persistence.
- Event name constants and payload types
  (`organization.created`/`.updated`/`.deleted`,
  `member.joined`/`.updated`/`.removed`) — types only, no publishing.
- `tenancyConfigSpec` — a real `ModuleConfigSpec` with two fields
  (invitation expiry, invitation rate limit). Not yet exercised end-to-end
  — nothing calls `loadModuleConfig(tenancyConfigSpec, …)` today, since no
  composition root installs Tenancy yet. Fields are required strings
  (`z.string().regex(...)`), not optional/coerced numbers —
  `ModuleConfigSpec<T>`'s `ZodType<T>` fixes Input and Output to the same
  `T`, which neither `.optional()` nor `z.coerce.number()` can satisfy
  under this repo's `exactOptionalPropertyTypes` (confirmed with an
  isolated `tsc` check; see the confirmed finding this added to
  `docs/engineering/e05-readiness-friction-log.md`). Defaults
  (`withTenancyConfigDefaults`) and numeric conversion
  (`resolveTenancyConfig`) both live one layer outside the schema as a
  result.
- A schema-only migration (`migrations/tenancy/0001_create-schema.sql`)
  and a README explaining the RLS-DDL bridge gap it defers.
- 8 test files (94 tests) covering the module scaffold (compilation
  smoke test, module-registration test, export-surface snapshot test),
  the `Organization` aggregate (value objects, status transitions,
  invariants, event emission/ordering, immutability), and
  `createOrganization` (success, duplicate slug, trimming, event
  publication, repository call counts, `UnitOfWork` usage, timestamp
  preservation) — all against in-memory test doubles only.

## What is intentionally **not** implemented

- **The `Membership`/`Invitation` aggregates.** `src/domain/membership.ts`
  and `invitation.ts` are still bare placeholder record types with zero
  invariant enforcement, explicitly marked as such in their own file
  comments. Ship in **E05-T03/T04**, following the pattern `Organization`
  (E05-T02) established.
- **`Organization`'s `kind` field and the four-state, two-phase-delete
  status machine** (`pending_deletion`/`purged`) from
  `tenancy-contract.md`'s blueprint reference — not modeled by the
  current three-state (`ACTIVE`/`SUSPENDED`/`DELETED`) aggregate. Open
  reconciliation, tracked in
  [organization-domain.md](../../docs/modules/organization-domain.md)'s
  non-goals.
- **Every other command** (`InviteMember`, `AcceptInvitation`, `UpdateOrganization`,
  …) — none exist. `createOrganization` is the first and, so far, only one.
  It is also not wired into `createTenancyModule`'s `useCases` —
  `TenancyUseCases` remains `Record<string, never>` until a future task
  wires commands into the module factory.
- **Creating a `Membership` for the requester as owner.**
  `tenancy-contract.md`'s blueprint describes `CreateOrganization` as
  atomically creating the org *and* an owner membership; this task's scope
  stopped at the `Organization` aggregate. `requestedBy` is captured on
  the command for this future purpose, unused today.
- **A hard slug-uniqueness guarantee.** `existsBySlug` is a best-effort,
  friendly-error check — nothing durable prevents two concurrent requests
  for the same slug from both passing it until E05-T21 adds a unique
  index. See create-organization-usecase.md's non-goals.
- **Repository persistence.** The four port methods (`findById`,
  `listForContext`, `existsBySlug`, `save`) are declared; no Postgres
  adapter exists. Lands in **E05-T21–T23**.
- **Real health signals.** `health()` always returns `{ status: "healthy"
  }`. Candidate signals (tenancy-schema reachability, a
  `pending_deletion`-past-`purge_after` backlog count) are noted as an open
  question in the contract doc — this task's own decision, deliberately
  left unresolved rather than invented ad hoc.
- **Real purge logic.** The registered handler **throws** on every
  invocation rather than silently succeeding — a loud placeholder, not a
  no-op, so a purge is never marked complete without a real delete once
  Tenancy owns actual data. Real deletion ships in **E05-T13**.
- **RLS.** The migration creates the `tenancy` schema only. Table DDL,
  roles, and RLS policies (including the open question of whether
  `organizations`' own RLS needs a membership-join condition rather than
  the standard pattern) are **E05-T21**'s job — see
  `migrations/tenancy/README.md`.
- **HTTP interface.** `src/interface/` is a reserved, empty barrel.
  **E05-T24–T25**.
- **Adopter-facing test fixtures.** `src/testing/` is a reserved, empty
  barrel, but its `./testing` export condition is declared in
  `package.json` now, so the import path is stable from day one.
  **E05-T28**.

## Next task

**E05-T04**: not yet specified by the founder directive sequence. Not started.

## See also

- [docs/modules/create-organization-usecase.md](../../docs/modules/create-organization-usecase.md) —
  the `createOrganization` use case's flow, sequence diagram, validation
  layers, and event mapping.
- [docs/modules/organization-domain.md](../../docs/modules/organization-domain.md) —
  the `Organization` aggregate's boundaries, invariants, transition
  diagram, and event list.
- [docs/modules/tenancy-contract.md](../../docs/modules/tenancy-contract.md) —
  the full future public contract this scaffold builds toward.
- [docs/security/how-to-build-a-tenant-safe-feature.md](../../docs/security/how-to-build-a-tenant-safe-feature.md) —
  mandatory reading before adding any tenant-scoped behavior here.
- [examples/acme-crm-module](../../examples/acme-crm-module) — the golden-
  path reference this scaffold follows for every tenant-isolation
  touchpoint (context resolution, `UnitOfWork`, org-scoped repository, RLS
  migration, event publishing, idempotent consumer, purge handler,
  health).
