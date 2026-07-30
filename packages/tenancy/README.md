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

This list describes the forward-looking blueprint contract; the aggregates
actually built so far diverge from it in specific, tracked ways (no
`kind` field on `Organization`, no token on `Invitation`) — see each
aggregate's own domain doc, linked below, for exactly what's built versus
still open.

## Architecture

Standard CoreStack module layout — the same Clean Architecture layering
and dependency rule as `@corestack/platform` and
[examples/acme-crm-module](../../examples/acme-crm-module):

```
src/
  domain/                     Organization (E05-T02) + Membership (E05-T04) + Invitation (E05-T05) aggregates
  application/                createOrganization (E05-T03) + inviteMember (E05-T06) + acceptInvitation (E05-T07) use cases; getOrganization + listOrganizationMembers + listPendingInvitations queries (E05-T12); repository ports, event contracts, config spec, module factory
  infrastructure/postgres/schema/  Drizzle table definitions (E05-T09) — schema only
  infrastructure/postgres/rls/     RLS policy DDL generators (E05-T10)
  infrastructure/postgres/postgres-*-repository.ts  Real Postgres repository adapters (E05-T11)
  postgres/                   `./postgres` package export barrel (E05-T11) — repositories, mappers, role bootstrap, RLS generators, constraint-violation helpers
  interface/                  reserved — HTTP bindings land in E05-T24..T25
  testing/                    reserved — adopter-facing fakes land in E05-T28
test-support/                 in-memory repositories + workflow harness + event collector (E05-T08) — internal, project-only; not exported, not adopter-facing
```

`test-support/` (sibling to `test/`, outside `src/`) and the reserved
`src/testing/` barrel serve different audiences and are not in tension:
`test-support/` is this package's own internal test scaffolding, invisible
to adopters and outside every architecture-fitness rule that scans `src/`;
`src/testing/` is reserved for E05-T28's adopter-facing fixtures, exported
through the package's public `./testing` condition. See
[tenancy-workflow-integration.md](../../docs/modules/tenancy-workflow-integration.md)'s
"Why `test-support/`, not `src/testing/`" section.

Every module — first-party or third-party — exports one factory,
`createTenancyModule(deps, config) => ModuleInstance`, per the module
lifecycle contract (E03-T20, `@corestack/platform`'s
`ModuleFactory`/`ModuleInstance`/`checkModuleConformance`). The
composition root calls this factory once, injecting adapters it already
constructed; the module never builds its own infrastructure.

## Current status: scaffold (E05-T01) + Organization domain/application (E05-T02/T03) + Membership domain (E05-T04) + Invitation domain (E05-T05) + inviteMember use case (E05-T06) + acceptInvitation use case (E05-T07) + in-memory workflow integration harness (E05-T08) + Postgres schema design (E05-T09) + RLS policy design (E05-T10) + Postgres repository adapters (E05-T11) + query services (E05-T12)

What exists today:

- **Query services** (`src/application/get-organization-query.ts`,
  `list-organization-members-query.ts`, `list-pending-invitations-query.ts`,
  E05-T12) — the module's complete read side: `getOrganization`,
  `listOrganizationMembers`, `listPendingInvitations`. Each returns a
  plain DTO (`OrganizationSummary`/`OrganizationMemberSummary`/
  `PendingInvitationSummary`), never an `Organization`/`Membership`/
  `Invitation` aggregate. **No new repository method was added** — every
  query is built entirely on `findById`/`listForOrganization`, unchanged
  since E05-T02/T04/T11, and relies entirely on RLS for tenant isolation
  (no query adds its own organization filter). `getOrganization`
  deliberately mirrors `OrganizationRepository.findById`'s exact shape —
  `context: OrgScopedContext` plus a separate target `organizationId` —
  so a mismatched target (asking about a different organization than the
  one the transaction is scoped to) returns `null` via RLS, the same as a
  genuinely missing row. `listOrganizationMembers` returns every
  membership regardless of status (never filtered out, only `removedAt`
  is hidden from the DTO); `listPendingInvitations` filters to `PENDING`
  only, sorted by `createdAt` ascending. `TenancyWorkflowHarness` gained
  matching `getOrganization`/`listOrganizationMembers`/
  `listPendingInvitations` wrapper methods, reusing the harness's
  existing repository/`UnitOfWork` wiring rather than a separate
  query-only test harness. New integration tests prove organization A
  cannot see organization B through any of the three queries, and that
  `existsBySlug`'s platform-role elevation does not leak into
  `getOrganization`'s visibility within the same transaction. Full
  detail: [docs/modules/tenancy-query-services.md](../../docs/modules/tenancy-query-services.md).
- **Real Postgres repository adapters** (`src/infrastructure/postgres/postgres-*-repository.ts`,
  exported from `@corestack/tenancy/postgres`, E05-T11) —
  `PostgresOrganizationRepository`/`PostgresMembershipRepository`/
  `PostgresInvitationRepository` replace the in-memory reference for
  real persistence. Every repository port method now takes
  `tx: TransactionContext` as its first parameter, threading the
  enclosing `PostgresUnitOfWork`'s open transaction through (the
  generic kernel type, not a Postgres-specific one — the ports stay
  adapter-agnostic; the in-memory repositories ignore the parameter).
  Dedicated mapper functions (`src/infrastructure/postgres/mappers/`)
  convert row ↔ aggregate explicitly, backed by a new
  `{Organization,Membership,Invitation}.reconstitute(...)` domain
  factory (loads persisted state with no domain-event emission,
  the counterpart to each aggregate's existing `create`). Database
  unique-constraint violations are translated into the same
  `DuplicateSlugError`/`MembershipAlreadyExistsError`/
  `InvitationAlreadyExistsError` the application layer already declares
  — the real enforcement behind each repository's best-effort
  `exists*` pre-check. `organizations`' `existsBySlug`/`findBySlug`
  elevate to the `tenancy_platform` role for one query each (ADR-0024's
  visibility model structurally can't see other organizations
  otherwise); `save` sets its own `app.current_org` from the
  aggregate's own id ([ADR-0025](../../docs/adr/0025-organization-save-sets-own-org-context.md)).
  16 new integration tests: 14 direct repository tests (round-trips, uniqueness,
  RLS isolation, soft-delete, timestamps, enums) plus 2 workflow-level
  tests reusing the existing `TenancyWorkflowHarness` with injected
  Postgres repositories/`UnitOfWork` factory (Section 10 reuse — no
  scenario duplication), run against a real PostgreSQL 18 instance via
  a new dual-mode integration harness (`test/integration/`,
  `pnpm test:integration`). No HTTP handlers, no background jobs, no
  anonymous invitation acceptance, no cross-organization admin
  features. Full detail:
  [docs/modules/tenancy-postgres-adapters.md](../../docs/modules/tenancy-postgres-adapters.md).
- **Row-Level Security policy design + migration** (`src/infrastructure/postgres/rls/`,
  `migrations/tenancy/0002_create-tenancy-tables.sql`, E05-T10) —
  resolves the `organizations` visibility question left open by E05-T09:
  direct (id-keyed) visibility, not membership-driven
  ([ADR-0024](../../docs/adr/0024-tenancy-organizations-rls-direct-visibility.md)).
  `memberships`/`invitations` use standard org-scoped policies
  (`organization_id = current_setting('app.current_org')::uuid`);
  `organizations` keys the identical predicate off `id` instead, applied
  uniformly to `SELECT`/`INSERT`/`UPDATE` (no special-cased creation
  bypass). `DELETE` is never granted or policied for the app role on any
  of the three tables — every terminal state transition is a soft-delete
  `status` `UPDATE`. Every table has both `ENABLE` and `FORCE ROW LEVEL
  SECURITY`. The migration's `CREATE TABLE` statements were generated via
  `drizzle-kit generate` against the frozen E05-T09 schema and
  hand-verified column-for-column; its RLS/GRANT statements are
  hand-authored but checked byte-for-byte against the TypeScript
  generator functions via a dedicated consistency test. No repository
  adapter, no SQL query methods, no HTTP handlers. Full detail:
  [docs/modules/tenancy-rls-design.md](../../docs/modules/tenancy-rls-design.md).
- **The Postgres persistence schema** (`src/infrastructure/postgres/schema/`,
  E05-T09) — Drizzle table definitions for `organizations`/`memberships`/
  `invitations`, freezing the database shape before any repository
  adapter is built. Enum-shaped columns (`status`/`role`) are
  CHECK-constrained `text`, not native Postgres `ENUM` types
  ([ADR-0023](../../docs/adr/0023-tenancy-schema-text-enum-with-check-constraint.md)),
  with each column's value set sourced directly from the matching domain
  enum constant so a renamed value breaks the schema file at compile
  time. Two partial unique indexes encode the state-dependent uniqueness
  rules: at most one `ACTIVE` membership per `(organization_id,
  user_id)`, and at most one `PENDING` invitation per `(organization_id,
  email)`. `organizations` uses a plain (non-partial) `UNIQUE(slug)` —
  unlike `tenancy-contract.md`'s 4-state blueprint, the implemented
  3-state `Organization` model has no `purged` state to key a partial
  index off of. RLS policies (E05-T10) and real Postgres repository
  adapters (E05-T11, see above) now query through this schema.
  `drizzle-orm` is a peer + dev dependency only, not re-exported from any
  package entry point yet. Full detail:
  [docs/modules/tenancy-schema-design.md](../../docs/modules/tenancy-schema-design.md)
  and
  [docs/modules/tenancy-persistence-mapping.md](../../docs/modules/tenancy-persistence-mapping.md).
- **The Tenancy workflow integration harness** (`test-support/`, E05-T08)
  — `InMemoryOrganizationRepository`/`MembershipRepository`/
  `InvitationRepository` (copy-on-write storage, implementing the real
  ports exactly, no new port methods added), an `EventCollector` that
  captures every published event in order with sequence/count/payload
  assertions, and a `TenancyWorkflowHarness` wiring class exposing
  `createOrganization`/`inviteMember`/`acceptInvitation` over one shared
  `UnitOfWork`/`FixedClock`/`EventBus` — so a full create → invite →
  accept workflow runs in memory, before any Postgres adapter exists.
  13 end-to-end tests (`test/workflow/tenancy-workflow.test.ts`) cover the
  happy path, duplicate slug/invitation, expiry, revocation, the
  inviter-authorization matrix, exactly-once invitation consumption, and
  transaction semantics — including a dedicated test proving (not just
  documenting) that the in-memory `UnitOfWork` provides event-staging
  atomicity but **not** storage rollback across multiple repository
  writes. Deliberately not a DI framework, no new repository port
  methods, no performance tuning (Section 12). Full detail:
  [docs/modules/tenancy-workflow-integration.md](../../docs/modules/tenancy-workflow-integration.md).
- **The `acceptInvitation` use case** — the membership-admission
  workflow: verifies the invitation exists and is `PENDING`
  (`InvitationNotFoundError`/`InvitationNotPendingError`), enforces
  expiry at acceptance time (`InvitationExpiredError` — persisting the
  `EXPIRED` transition and publishing its event even on this failing
  path), checks the accepting user's claimed email against the
  invitation's own (`ForbiddenError` on mismatch), verifies no duplicate
  active membership (`MembershipAlreadyExistsError`), then atomically
  creates a `Membership` and marks the invitation `ACCEPTED` inside one
  `UnitOfWork`, publishing `member.joined` and `invitation.accepted`.
  Returns
  `Result<AcceptInvitationResult, ValidationError | ForbiddenError |
  InvitationNotFoundError | InvitationExpiredError |
  InvitationNotPendingError | MembershipAlreadyExistsError>` — a DTO,
  never either aggregate. Full detail:
  [docs/modules/accept-invitation-usecase.md](../../docs/modules/accept-invitation-usecase.md).
  No repository adapter, no SQL, no RLS, no HTTP, no email delivery, no
  invitation tokens — in-memory test doubles only, same as
  `createOrganization`/`inviteMember`.
- **The `inviteMember` use case** — coordinates the `Organization`,
  `Invitation`, and (as of E05-T07) the inviter's own `Membership`:
  `ForbiddenError` on a client-claimed `organizationId` mismatch,
  `CannotInviteOwnerError` before aggregate creation,
  `InviterNotAuthorizedError` when the inviter lacks an `ACTIVE`
  `OWNER`/`ADMIN` membership permitted to invite the target role
  (`canInviteAs`, E05-T07 Section 8 — closes the authorization gap this
  same doc flagged as open after E05-T06),
  `InvitationAlreadyExistsError` on a pending duplicate, an
  application-level expiry policy (`invitationExpiryDays`, injected
  clock), and event publication through `UnitOfWork` via the first
  `INVITATION_*` wire contract. Returns
  `Result<InviteMemberResult, ValidationError | ForbiddenError |
  NotFoundError | ConflictError | CannotInviteOwnerError |
  InvitationAlreadyExistsError | InviterNotAuthorizedError>` — a DTO,
  never the aggregate. Full detail:
  [docs/modules/invite-member-usecase.md](../../docs/modules/invite-member-usecase.md).
  No repository adapter, no SQL, no RLS, no HTTP, no email delivery, no
  invitation acceptance — in-memory test doubles only, same as
  `createOrganization`.
- **The `Invitation` aggregate** — a pure domain model: `InvitationId`
  (own value object) + reused `OrganizationId`/`UserId` + a temporary,
  locally-scoped `Email` value object; an `InvitationRole` enum
  (`ADMIN`/`MEMBER` only — no `OWNER`, runtime-validated since the role
  typically originates from external input) and an `InvitationStatus`
  enum (`PENDING`/`ACCEPTED`/`REVOKED`/`EXPIRED` — `PENDING` the only
  mutable state, the other three all terminal); explicit methods
  (`create`/`accept`/`revoke`/`expire`), domain events collected via
  `pullDomainEvents()`/`clearDomainEvents()`. No persistence, no I/O, no
  kernel port dependency, **no token field** (token generation/hashing is
  explicitly out of scope — a domain concern for a future task). Full
  detail:
  [docs/modules/invitation-domain.md](../../docs/modules/invitation-domain.md).
- **The `Membership` aggregate** — a pure domain model: `MembershipId`
  (own value object) + reused `OrganizationId` + a temporary, locally-scoped
  `UserId` value object; a `MembershipRole` enum (`OWNER`/`ADMIN`/`MEMBER`,
  `OWNER` structurally locked against downgrade/removal through this
  aggregate) and a `MembershipStatus` enum (`ACTIVE`/`SUSPENDED`/`REMOVED`,
  `REMOVED` terminal); explicit methods (`create`/`promoteToAdmin`/
  `demoteToMember`/`suspend`/`reactivate`/`remove`), domain events
  collected via `pullDomainEvents()`/`clearDomainEvents()`. No
  persistence, no I/O, no kernel port dependency. Full detail:
  [docs/modules/membership-domain.md](../../docs/modules/membership-domain.md).
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
- The package itself: manifest, tsconfig, `vitest.config.ts` (the first
  bare one in this repo — see the file's own comment), LICENSE, this
  README.
- `createTenancyModule`: registers a purge subscription and a static
  `health()` stub; returns an empty `useCases: {}`.
- Repository ports (`OrganizationRepository`, `MembershipRepository`,
  `InvitationRepository`) — interfaces only, no persistence. Each of
  `MembershipRepository`'s (E05-T04) and `InvitationRepository`'s
  (E05-T05) two methods was mechanically updated to return the real
  aggregate instead of its superseded placeholder record type — the same
  forced fix `OrganizationRepository` went through in E05-T02.
  `InvitationRepository` gained two more methods in E05-T06
  (`existsPendingForEmail`, `save`) to support `inviteMember`.
  `MembershipRepository` gained three more in E05-T07 (`findByUserId`,
  `existsActive`, `save`) to support `inviteMember`'s authorization check
  and `acceptInvitation`'s duplicate-membership check/persistence.
  `InvitationRepository` deliberately did **not** gain a `findPendingById`
  method in E05-T07 despite the founder directive suggesting one — the
  existing `findById` (any status) is what `acceptInvitation` actually
  needs, since it must distinguish "not found" from "found but not
  pending," which a pending-filtered lookup couldn't. See
  [accept-invitation-usecase.md](../../docs/modules/accept-invitation-usecase.md).
- Event name constants and payload types
  (`organization.created`/`.updated`/`.deleted`,
  `member.joined`/`.updated`/`.removed`, `invitation.created`/
  `.accepted`/`.expired` — the last three added across E05-T06/T07, the
  first `INVITATION_*` wire contracts) — `MemberJoinedPayload.role` was
  fixed from a lowercase T01 placeholder to the real, uppercase
  `MembershipRole` values in E05-T07, the first task to actually publish
  it.
- `tenancyConfigSpec` — a real `ModuleConfigSpec` with three fields
  (invitation expiry in hours — superseded, unread; invitation expiry in
  days — added E05-T06, actually read by `inviteMember`; invitation rate
  limit). Not yet exercised end-to-end
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
  and the real table + RLS migration
  (`migrations/tenancy/0002_create-tenancy-tables.sql`, E05-T10).
- 27 unit test files (391 tests) plus 1 real-Postgres integration test
  file (20 tests, `pnpm test:integration`) covering the module scaffold (compilation
  smoke test, module-registration test, export-surface snapshot test),
  the `Organization` aggregate (value objects, status transitions,
  invariants, event emission/ordering, immutability), `createOrganization`
  (success, duplicate slug, trimming, event publication, repository call
  counts, `UnitOfWork` usage, timestamp preservation), the `Membership`
  aggregate (value objects, role/status transition tables, owner-lock
  invariants, event emission/ordering, immutability), the
  `Invitation` aggregate (value objects, email normalization, owner-role
  rejection, expiry-at-creation validation, status transition tables,
  event emission/ordering, immutability), `inviteMember` (success,
  email normalization, owner-role rejection, duplicate pending
  invitation, inactive/not-found organization, organizationId mismatch,
  event publication/suppression, expiry-from-clock computation,
  repository/`UnitOfWork` call counts, plus an exhaustive E05-T07
  inviter-authorization matrix), and `acceptInvitation` (success at both
  `ADMIN`/`MEMBER` roles, invitation not found, email mismatch,
  not-pending for accepted/revoked, expiry enforcement with persistence
  and event assertions, duplicate active membership, event
  publication, `UnitOfWork` usage) — all against in-memory test doubles
  only — plus the 13 end-to-end workflow tests described above
  (E05-T08), 23 no-live-database schema tests (E05-T09) verifying the
  Drizzle schema builds, enum values match the domain enums exactly, and
  the expected unique/partial-unique indexes and foreign keys exist, and
  47 no-live-database RLS/migration tests (E05-T10): 40 verifying the RLS
  DDL generators (ENABLE/FORCE ordering, stable per-command policy names,
  DELETE never granted/policied, `platform_full_access` present, fail-
  closed `current_setting` usage, no bind parameters, bare — never
  schema-qualified — column references, unsafe-identifier rejection) and
  7 verifying the shipped migration parses cleanly and matches those same
  generators' output byte-for-byte, plus 13 new query-service unit tests
  (E05-T12: DTO field mapping, sort order, `PENDING`-only filtering,
  cross-organization isolation against in-memory test doubles) and 4 new
  integration tests proving organization A cannot see organization B
  through any of the three queries and that platform-role elevation
  doesn't leak into query visibility — 20 real-Postgres integration
  tests in total (E05-T11 + E05-T12).

## What is intentionally **not** implemented

- **Invitation tokens, email delivery, and the acceptance workflow.**
  `Invitation` (E05-T05) has no `tokenHash` field at all — a deliberate
  departure from the E05-T01 scaffold's placeholder `InvitationRecord`,
  which had one. Token generation/hashing and sending the invitation are
  explicitly out of scope for the domain model. See
  [invitation-domain.md](../../docs/modules/invitation-domain.md)'s
  non-goals and "Future invitation-token note".
- **Ownership transfer.** Neither `Membership` nor `Invitation` has a
  method that moves `OWNER` from one membership to another, and
  `InvitationRole` structurally excludes `OWNER` entirely — transfer
  requires coordinating two aggregate instances atomically, an
  application-layer concern. See
  [membership-domain.md](../../docs/modules/membership-domain.md)'s and
  [invitation-domain.md](../../docs/modules/invitation-domain.md)'s
  non-goals.
- **`Organization`'s `kind` field and the four-state, two-phase-delete
  status machine** (`pending_deletion`/`purged`) from
  `tenancy-contract.md`'s blueprint reference — not modeled by the
  current three-state (`ACTIVE`/`SUSPENDED`/`DELETED`) aggregate. Open
  reconciliation, tracked in
  [organization-domain.md](../../docs/modules/organization-domain.md)'s
  non-goals.
- **Every command except `createOrganization`, `inviteMember`, and
  `acceptInvitation`** (`UpdateOrganization`, `RevokeInvitation`, any
  other `Membership` command, …) — none exist. None of the three
  existing use cases is wired into `createTenancyModule`'s `useCases` —
  `TenancyUseCases` remains `Record<string, never>` until a future task
  wires commands into the module factory.
- **The active-membership check in `inviteMember`.** Section 4 step 2 of
  the E05-T06 directive is unrepresentable today — `Membership` keys off
  `userId`, and no email→userId mapping exists anywhere in this codebase.
  See invite-member-usecase.md's non-goals. (Authorization — *is the
  inviter permitted to invite* — is a separate concern from this one and
  was resolved in E05-T07; see below.)
- **Re-authorizing an invitation at acceptance time.** `acceptInvitation`
  honors an invitation's role as-issued; it does not re-run
  `canInviteAs` against the original inviter's *current* membership.
  Authorization is a creation-time concern only. See
  [accept-invitation-usecase.md](../../docs/modules/accept-invitation-usecase.md)'s
  "Membership creation" section.
- **Identity verification in `acceptInvitation`.** The accepting user's
  email is checked for equality against the invitation's own, but neither
  it nor the accepting `userId` is authenticated — no `User`/session/auth
  module exists in this codebase, and Section 13 explicitly prohibits
  introducing one here. See accept-invitation-usecase.md's "Trust
  assumptions".
- **A hard duplicate-membership guarantee in `acceptInvitation`.**
  `existsActive` is a best-effort check, same shape as
  `existsBySlug`/`existsPendingForEmail` — E05-T21's job to make durable.
- **Creating a `Membership` for the requester as owner.**
  `tenancy-contract.md`'s blueprint describes `CreateOrganization` as
  atomically creating the org *and* an owner membership; E05-T03's scope
  stopped at the `Organization` aggregate, and `Membership` (E05-T04) has
  no use case wiring it in yet either. `requestedBy` is captured on the
  command for this future purpose, unused today — and
  create-organization-usecase.md now flags that `requestedBy` and
  `context.actor.id` carry the same identity from different trust levels,
  a decision that future task must resolve.
- **A hard slug-uniqueness guarantee.** `existsBySlug` is a best-effort,
  friendly-error check — nothing durable prevents two concurrent requests
  for the same slug from both passing it until E05-T21 adds a unique
  index. See create-organization-usecase.md's non-goals.
- **Repository persistence.** The port methods across all three
  repositories are declared; no Postgres adapter exists. Lands in
  **E05-T21–T23**.
- **Real health signals.** `health()` always returns `{ status: "healthy"
  }`. Candidate signals (tenancy-schema reachability, a
  `pending_deletion`-past-`purge_after` backlog count) are noted as an open
  question in the contract doc — this task's own decision, deliberately
  left unresolved rather than invented ad hoc.
- **Real purge logic.** The registered handler **throws** on every
  invocation rather than silently succeeding — a loud placeholder, not a
  no-op, so a purge is never marked complete without a real delete once
  Tenancy owns actual data. Real deletion ships in **E05-T13**.
- **HTTP handlers, background jobs, anonymous invitation acceptance,
  cross-organization admin features.** Real Postgres repository
  adapters (E05-T11) and query services (E05-T12) now exist — see
  above — but nothing wires them into an HTTP interface or a background
  job yet; anonymous acceptance and admin bypasses remain explicitly out
  of scope (Section 1/14 of the E05-T12 directive).
- **Pagination, filtering, and search on the query services.** Both list
  queries return every matching row in one call; neither accepts a role
  filter, a search term, or a cursor/limit parameter (Section 14 of the
  E05-T12 directive: "keep the read side minimal and explicit"). See
  tenancy-query-services.md's "Future pagination note"/"Future filtering
  note".
- **`TenancyUseCases` still does not include the query services.** Like
  `createOrganization`/`inviteMember`/`acceptInvitation` before them,
  `getOrganization`/`listOrganizationMembers`/`listPendingInvitations`
  are standalone exported functions, not wired into
  `createTenancyModule`'s `useCases` object — the same deferred-wiring
  precedent noted above for the write-side use cases.
- **HTTP interface.** `src/interface/` is a reserved, empty barrel.
  **E05-T24–T25**.
- **Adopter-facing test fixtures.** `src/testing/` is a reserved, empty
  barrel, but its `./testing` export condition is declared in
  `package.json` now, so the import path is stable from day one.
  **E05-T28**.

## Next task

**E05-T13**: not yet specified by the founder directive sequence. Not
started. Per Section 15 of the E05-T12 directive, HTTP interfaces and
background jobs are explicitly **not** to be started automatically — it
waits for an explicit E05-T13 prompt.

## See also

- [docs/modules/tenancy-query-services.md](../../docs/modules/tenancy-query-services.md) —
  the query services (E05-T12): query boundaries, DTO rationale, RLS
  assumptions, sorting guarantees, and the future pagination/filtering
  notes.
- [docs/modules/tenancy-postgres-adapters.md](../../docs/modules/tenancy-postgres-adapters.md) —
  the Postgres repository adapters (E05-T11): transaction boundaries,
  mapper strategy, RLS assumptions (including the `existsBySlug`/
  `findBySlug` platform-role elevation), constraint-violation
  translation, operational considerations, and known limitations.
- [docs/adr/0025-organization-save-sets-own-org-context.md](../../docs/adr/0025-organization-save-sets-own-org-context.md) —
  why `PostgresOrganizationRepository.save` sets its own `app.current_org`
  from the aggregate's own id, correcting a specific claim in ADR-0024.
- [docs/modules/tenancy-rls-design.md](../../docs/modules/tenancy-rls-design.md) —
  the RLS policy design (E05-T10): policy matrix, the `organizations`
  direct-visibility model, fail-closed behaviour (including the
  `app.current_org`-vs-`app.current_organization_id` reconciliation
  note), the future anonymous-invitation-acceptance and cross-org-admin
  non-goals, repository assumptions for a future adapter, and operational
  considerations.
- [docs/adr/0024-tenancy-organizations-rls-direct-visibility.md](../../docs/adr/0024-tenancy-organizations-rls-direct-visibility.md) —
  why `organizations`' RLS uses direct (id-keyed) visibility instead of
  membership-driven or hybrid visibility.
- [docs/modules/tenancy-schema-design.md](../../docs/modules/tenancy-schema-design.md) —
  the Postgres schema design (E05-T09): ER diagram, index/partial-index
  rationale, deletion strategy, membership/invitation uniqueness
  strategy, repository persistence expectations (transactional/
  uniqueness/concurrency), RLS attachment points for a future task
  (including the still-open `organizations` question), and non-goals.
- [docs/modules/tenancy-persistence-mapping.md](../../docs/modules/tenancy-persistence-mapping.md) —
  the field-by-field mapping from each aggregate to its Postgres row.
- [docs/adr/0023-tenancy-schema-text-enum-with-check-constraint.md](../../docs/adr/0023-tenancy-schema-text-enum-with-check-constraint.md) —
  why enum-shaped columns are CHECK-constrained `text`, not native
  Postgres `ENUM` types.
- [docs/modules/tenancy-workflow-integration.md](../../docs/modules/tenancy-workflow-integration.md) —
  the in-memory workflow harness (E05-T08): repository behavior, event
  capture, a full happy-path sequence diagram, transaction-semantics
  verification (including the proven storage-rollback limitation), a
  failure-semantics table, and non-goals.
- [docs/modules/accept-invitation-usecase.md](../../docs/modules/accept-invitation-usecase.md) —
  the `acceptInvitation` use case's flow, sequence diagram, the
  authorization matrix (shared with `inviteMember`), expiry enforcement,
  membership creation, event flow, and trust assumptions around identity.
- [docs/modules/invite-member-usecase.md](../../docs/modules/invite-member-usecase.md) —
  the `inviteMember` use case's flow, sequence diagram, the
  client-claimed-`organizationId` check, expiry policy (and the
  `invitationExpiryHours`-vs-`invitationExpiryDays` config note),
  duplicate handling, and event mapping.
- [docs/modules/invitation-domain.md](../../docs/modules/invitation-domain.md) —
  the `Invitation` aggregate's boundaries, role/status models, invariants,
  expiry semantics, event list, and the future-token/ownership-transfer
  non-goals.
- [docs/modules/membership-domain.md](../../docs/modules/membership-domain.md) —
  the `Membership` aggregate's boundaries, role/status models, invariants,
  event list, and the ownership-transfer non-goal.
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
