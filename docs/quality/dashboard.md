# CoreStack Quality Dashboard

> **Maintained automatically** — updated at every epic exit, milestone exit,
> and remediation batch (governance §7.3). Numbers are from real runs, never
> estimated. Last update: **2026-07-31** — **E05-T14 (Tenancy
> invitation-notification orchestration) complete**: the durable
> background-processing side of invitation notifications —
> `INVITATION_CREATED`/`INVITATION_ACCEPTED`/`INVITATION_EXPIRED` domain
> events now produce durable `tenancy.notification_work_items` rows
> (`PENDING` status); `MEMBER_JOINED` explicitly ignored. **No email is
> sent** — no SendGrid/SES/Postmark/SMTP client, no cron job, no
> background worker anywhere in this package.
> `buildNotificationWorkItemFromEvent` is a pure, total mapping function
> (zero I/O); `createInvitationNotificationSubscription` wraps it in one
> idempotent, transactionally-atomic handler — **a single wildcard
> (`event: "*"`) `EventSubscription`, not three**, since the outbox
> relay's checkpoint is keyed by consumer name alone and three
> subscriptions sharing one consumer name across three event names would
> each independently advance the same checkpoint row (a hazard the
> existing duplicate-registration check does not catch). Atomicity comes
> from a hand-rolled transaction (`hasProcessed` → build → insert →
> `markProcessed`, all against one `PostgresUnitOfWork`), not the
> kernel's generic three-step `idempotentHandler` wrapper, satisfying
> Section 8's "transaction rollback safety" test.
> `PostgresNotificationWorkItemRepository` is the package's first real
> `GlobalRepository`
> ([ADR-0026](../adr/0026-notification-work-item-repository-is-global.md))
> — its only caller is a replayed domain event, not an authenticated
> request. **A real bug this task's own integration tests caught**: the
> first design elevated to `tenancy_platform` only around the
> repository's own `INSERT`, leaving the `ProcessedEventStore` calls
> running unprivileged and failing with a permission error; fixed by
> moving role elevation to the first statement in the transaction, before
> any check. `createInvitationNotificationSubscription` is exported from
> `@corestack/tenancy/postgres` but **not** registered into
> `createTenancyModule`'s `eventHandlers` by this task — the same
> deferred-wiring cut E05-T13 made for `tenancyRoutes`. Full detail:
> [tenancy-notification-orchestration.md](../modules/tenancy-notification-orchestration.md).
> Full build/typecheck/lint/test/integration-test/architecture-fitness/
> export-snapshot gate green repo-wide (tenancy unit tests 450→466,
> 37→40 files; integration file 34→41 tests, run twice for stability).
> Prior update: **2026-07-30** — **E05-T13 (Tenancy HTTP
> interface) complete**: a thin HTTP adaptation layer over the existing use
> cases and query services — six routes (`POST /organizations`, `POST
> /organizations/:id/invitations`, `POST /invitations/:id/accept`, `GET
> /organizations/:id`, `GET /organizations/:id/members`, `GET
> /organizations/:id/invitations`), new `src/interface/http/`, exported
> from a new `./interface` subpath. **No new repository method, use case,
> or query was added.** No HTTP framework exists anywhere in this monorepo
> yet — every handler is a plain `async` function with one `try`/`catch`;
> `tenancyRoutes` is declarative route metadata a future Hono binding
> would register, not a router this package implements (Section 14: no
> controller framework, no middleware abstractions, no DI container).
> `context.organizationId` always comes from an `X-Organization-Id`
> header, never the URL path, even on routes whose path also names an
> organization — a deliberate stand-in for a real authentication provider
> (explicitly out of scope), validated as UUID-shaped everywhere it's
> used. 404, never 403, for cross-tenant reads: `GET /organizations/:id`
> relies entirely on RLS via `getOrganization`'s existing target-vs-context
> shape; the two list routes call `getOrganization` as an explicit
> pre-check before their own list query, since neither underlying query
> service has an independent target parameter. One error-mapping function
> derives HTTP status from the kernel `CoreError` taxonomy — every
> tenancy-specific error class already extends one of the five mapped
> classes, so the table needs no per-class entry (one documented
> consequence: the invite route's role enum makes `CannotInviteOwnerError`
> unreachable via HTTP, though it remains reachable for direct callers).
> Documented divergences from the future full API standard: 400 not 422,
> `{code, message, metadata}` not RFC 9457 `problem+json`, bare arrays not
> `{data, pagination}`, no `/v1` prefix. Sharpest trust-boundary
> limitation, documented explicitly: `POST /invitations/:id/accept` has no
> organization id in its path at all and takes the accepting user's
> claimed email from the request body — security rests entirely on
> `acceptInvitation`'s own pre-existing email-equality check. Full detail:
> [tenancy-http-interface.md](../modules/tenancy-http-interface.md). No
> authentication providers, no background jobs, no anonymous invitation
> acceptance, no pagination, no filtering, no search. Full
> build/typecheck/lint/test/integration-test/architecture-fitness/
> export-snapshot gate green repo-wide (tenancy unit tests 391→450,
> 27→37 files; integration file 20→34 tests, run twice for stability;
> architecture-fitness unchanged at 36). Prior update: **2026-07-30** —
> **E05-T12 (Tenancy query
> services) complete**: the module's complete read side —
> `getOrganization`/`listOrganizationMembers`/`listPendingInvitations`,
> each returning a plain DTO (`OrganizationSummary`/
> `OrganizationMemberSummary`/`PendingInvitationSummary`) via an explicit
> aggregate-to-DTO mapper, never an aggregate. **No new repository method
> was added** — every query is built on `findById`/`listForOrganization`,
> unchanged since E05-T02/T04/T11; each still opens a `UnitOfWork.run()`
> call purely to reach a `TransactionContext`, but nothing is ever staged
> on `tx.publish`. `getOrganization` mirrors `OrganizationRepository
> .findById`'s exact shape (`context` plus a separate target
> `organizationId`), reusing the identical RLS mechanism T11 already
> proved — a mismatched target returns `null`, exactly like a missing
> row. DTO field lists match the founder directive exactly, including
> two deliberate omissions (`OrganizationSummary` excludes `deletedAt`,
> `OrganizationMemberSummary` excludes `removedAt` — both already
> communicated via `status`). `listOrganizationMembers` does not filter
> by status; `listPendingInvitations` filters to `PENDING` only and
> carries no `status` field. Both list queries sort in the application
> layer, not via `ORDER BY` in the shared repository method.
> `TenancyWorkflowHarness` gained matching wrapper methods. New
> integration tests prove organization A cannot see organization B
> through any of the three queries, and that `existsBySlug`'s
> platform-role elevation does not leak into `getOrganization`'s
> visibility within the same transaction; the existing golden-path
> workflow test now also exercises all three queries after its accept
> step. Full detail:
> [tenancy-query-services.md](../modules/tenancy-query-services.md). No
> HTTP handlers, no background jobs, no anonymous invitation acceptance,
> no cross-organization admin features, no pagination, no filtering, no
> search. Full build/typecheck/lint/test/integration-test/architecture-
> fitness/export-snapshot gate green repo-wide (tenancy unit tests
> 378→391, 24→27 files; integration file 16→20 tests, run twice for
> stability; architecture-fitness unchanged at 36). Prior update:
> **2026-07-30** — **E05-T11 (Tenancy real
> Postgres repository adapters) complete**: `PostgresOrganizationRepository`/
> `PostgresMembershipRepository`/`PostgresInvitationRepository` replace the
> in-memory reference, exported from a new `@corestack/tenancy/postgres`
> subpath. Every repository port method now takes `tx: TransactionContext`
> (the generic kernel type) as its first parameter, threading the
> enclosing `PostgresUnitOfWork`'s open transaction through — required
> because every real call happens inside a `UnitOfWork.run()` callback and
> the platform's own transaction-ownership rule forbids opening a second
> transaction there. New `{Organization,Membership,Invitation}.reconstitute(...)`
> domain factories back three new mapper modules (row ↔ aggregate, no
> inline mapping). Database unique-constraint violations (`SQLSTATE
> 23505` + `constraint_name`, confirmed empirically against real
> PostgreSQL 18.4) are translated into `DuplicateSlugError`/
> `MembershipAlreadyExistsError`/`InvitationAlreadyExistsError` — the real
> enforcement behind each repository's best-effort `exists*` pre-check,
> now reachable from the use cases via a new `try`/`catch` around each
> `save()` call. **[ADR-0025](../adr/0025-organization-save-sets-own-org-context.md):**
> corrects ADR-0024's claim that `PostgresUnitOfWork`'s constructor sets
> `app.current_org` for organization creation (impossible — the
> aggregate's id doesn't exist yet at that point) — `save` sets it itself.
> `existsBySlug`/`findBySlug` elevate to the `tenancy_platform` role for
> one query each; `ensureTenancyModuleRoles` gained `GRANT tenancy_platform
> TO tenancy_app WITH INHERIT FALSE` — confirmed empirically that a plain
> inheriting grant would silently and permanently disable tenant isolation
> for the app role. **Fixed a real, previously-undiscovered defect**:
> tenancy's own `vitest.config.ts` (E05-T01) excluded `test/integration/**`
> even when explicitly targeted via the CLI — `pnpm test:integration`
> could never have worked before this task; fixed with a dedicated
> `vitest.integration.config.ts`. `TenancyWorkflowHarness` gained two
> optional constructor options (`repositories`/`uowFactory`) enabling the
> same E05-T08 workflow scenarios' harness to run against real Postgres
> without duplicating them. New dual-mode integration-test harness with
> 16 tests (14 direct repository, 2 workflow-level), run separately via
> `pnpm test:integration` against real PostgreSQL 18. Full detail:
> [tenancy-postgres-adapters.md](../modules/tenancy-postgres-adapters.md).
> No HTTP handlers, no background jobs, no anonymous invitation
> acceptance, no cross-organization admin features. Full
> build/typecheck/lint/test/architecture-fitness/export-snapshot gate
> green repo-wide (tenancy unit tests 377→378, 24 files unchanged, plus a
> new 16-test integration file; architecture-fitness unchanged at 36;
> export-snapshot updated for the new `./postgres` subpath). Prior
> update: **2026-07-30** — **E05-T10 (Tenancy Row-Level
> Security policy design + migration) complete**: resolves the
> `organizations` visibility question E05-T09 left open. New
> `src/infrastructure/postgres/rls/` (internal): per-command RLS policy
> generators for `memberships`/`invitations` (standard org-scoping) and
> `organizations` (direct, id-keyed visibility), plus
> `ensureTenancyModuleRoles` (idempotent role/grant bootstrap).
> **[ADR-0024](../adr/0024-tenancy-organizations-rls-direct-visibility.md):**
> `organizations` uses direct visibility — `id =
> current_setting('app.current_org')::uuid`, identical across
> `SELECT`/`INSERT`/`UPDATE`, no special-cased creation bypass — over
> membership-driven/hybrid visibility, both of which need a
> currently-nonexistent user-identity session variable. Uses the
> platform's existing `app.current_org`, not the founder directive's
> literal `app.current_organization_id` — flagged for founder
> confirmation, not silently decided. `DELETE` never granted or policied
> for the app role on any of the three tables; platform role granted
> `SELECT` only. New migration
> `migrations/tenancy/0002_create-tenancy-tables.sql`: `CREATE TABLE`
> statements generated via `drizzle-kit generate` against the frozen
> E05-T09 schema and hand-verified; RLS/GRANT statements checked
> byte-for-byte against the TypeScript generators via a dedicated
> consistency test. **Fixed a real bug found during review**: every
> `CHECK` constraint and RLS predicate initially referenced its column
> schema/table-qualified (e.g. `tenancy.organizations.status`) — invalid
> Postgres syntax in both positions — corrected to bare column names
> throughout, including a latent instance in the E05-T09 `sqlInList`
> schema helper. 47 new no-live-database tests (40 DDL-level, 7
> migration-consistency). Full detail:
> [tenancy-rls-design.md](../modules/tenancy-rls-design.md). No
> repository adapters, no SQL query methods, no HTTP handlers. Tenancy
> package tests 330→377 (+47, 22→24 files). Full
> build/typecheck/lint/test/architecture-fitness/export-snapshot gate
> green repo-wide (architecture-fitness unchanged at 36; export-snapshot
> unchanged — no new public exports this task). Prior update:
> **2026-07-30** — **E05-T09 (Tenancy Postgres
> schema design) complete**: freezes the tenancy database shape before any
> repository adapter is built. New `src/infrastructure/postgres/schema/`
> (internal, no `./postgres` package export yet): Drizzle table
> definitions for `tenancy.organizations`/`tenancy.memberships`/
> `tenancy.invitations`. `drizzle-orm` added as an optional peer + dev
> dependency — the "first module repository adapter" moment
> [ADR-0017](../adr/0017-drizzle-deferred-to-first-module-repository.md)
> anticipated. **[ADR-0023](../adr/0023-tenancy-schema-text-enum-with-check-constraint.md):**
> enum-shaped columns are CHECK-constrained `text`, not native Postgres
> `ENUM` types, sourced directly from each domain enum constant so a
> renamed value is a compile error in the schema file. Two partial unique
> indexes encode the state-dependent uniqueness rules (one `ACTIVE`
> membership per org+user; one `PENDING` invitation per org+email) —
> verified empirically that both `WHERE` predicates and all `CHECK`
> constraints render as literal SQL with no bind parameter. `organizations`
> uses a plain `UNIQUE(slug)` (the implemented 3-state model has no
> `purged` state to key a partial index off of, unlike the 4-state
> blueprint). No `version` column on any table and no DB-side
> `.defaultNow()` on creation timestamps — both flagged explicitly rather
> than silently added or omitted. Repository persistence expectations
> (transactional/uniqueness/concurrency/eventual-consistency) documented
> against all three existing ports with a cross-reference added to each
> port's own doc comment — no new port methods. RLS attachment points
> documented, not implemented: `memberships`/`invitations` need no new
> mechanism (`buildTenantIsolationDdl`, E03-T30); `organizations` is
> flagged as needing a real design decision, deferred to a future RLS
> task. 23 new no-live-database schema tests. Full detail:
> [tenancy-schema-design.md](../modules/tenancy-schema-design.md) and
> [tenancy-persistence-mapping.md](../modules/tenancy-persistence-mapping.md).
> Tenancy package tests 307→330 (+23, 1 new file; 21→22 files). Full
> build/typecheck/lint/test/architecture-fitness/export-snapshot gate
> green repo-wide (architecture-fitness unchanged at 36; export-snapshot
> unchanged — no new public exports this task). Prior update:
> **2026-07-30** — **E05-T08 (Tenancy workflow
> integration harness) complete**: an in-memory harness validating the
> full create → invite → accept workflow across repositories,
> `UnitOfWork`, and event publication before any persistence adapter
> exists. New `test-support/` directory (sibling to `test/`, outside the
> public `src/` surface — same precedent as `packages/platform/test-support/`):
> `InMemoryOrganizationRepository`/`InMemoryMembershipRepository`/
> `InMemoryInvitationRepository` (copy-on-write `Map` storage,
> implementing the real ports exactly, no new port methods), an
> `EventCollector` (ordered capture, `expectSequence`/`expectNone`/
> `expectCount`/`payloadAt`), and a `TenancyWorkflowHarness` wiring class
> exposing `createOrganization`/`inviteMember`/`acceptInvitation` over one
> shared `UnitOfWork`/`FixedClock`/`EventBus` pair. **Deliberately did not
> add** `OrganizationRepository.findBySlug` or
> `MembershipRepository.findByOrganizationAndUser` — no scenario needs
> the former, and the existing `findByUserId(context, userId)` already
> covers the latter. 13 new end-to-end tests
> (`test/workflow/tenancy-workflow.test.ts`): happy path with exact
> event-sequence assertions, duplicate slug/invitation,
> expired/revoked invitation, the full inviter-authorization matrix,
> exactly-once invitation consumption, and three transaction-semantics
> tests. **Proved, not just documented, a real limitation**: a dedicated
> test wraps the real invitation repository in a `save`-throwing
> decorator and calls `acceptInvitation` directly, confirming the
> in-memory `UnitOfWork` provides event-staging atomicity but no storage
> rollback across multiple repository writes — closing that gap is
> `PostgresUnitOfWork` (E03-T40)'s job, out of this task's scope. No
> Postgres adapters, no SQL, no RLS, no migrations, no Drizzle schemas,
> no HTTP handlers, no performance tuning, no dependency-injection
> framework. Full detail:
> [tenancy-workflow-integration.md](../modules/tenancy-workflow-integration.md).
> Tenancy package tests 294→307 (+13, 1 new test file; 20→21 files). Full
> build/typecheck/lint/test/architecture-fitness/export-snapshot gate
> green repo-wide (architecture-fitness unchanged at 36; export-snapshot
> unchanged — no new public exports this task). Prior update:
> **2026-07-30** — **E05-T07 (`acceptInvitation`
> use case + `inviteMember` authorization) complete**: the third real
> application service in `@corestack/tenancy` — `acceptInvitation`, the
> membership-admission workflow, coordinating the `Invitation` and
> `Membership` aggregates, `InvitationRepository`, `MembershipRepository`,
> and `UnitOfWork` event publication. `InvitationNotFoundError`,
> `InvitationExpiredError`/`InvitationNotPendingError`/
> `MembershipAlreadyExistsError` (extend `ConflictError`),
> `InviterNotAuthorizedError` (extends `ForbiddenError`, consumed by
> `inviteMember`, not `acceptInvitation`). **Expiry enforcement moved to
> acceptance time** — `Invitation.expire()` (E05-T05) never compares `now`
> against `expiresAt` itself; discovering an expiry here persists the
> `EXPIRED` transition and publishes its event *before*
> `InvitationExpiredError` is returned, since stored state must reflect
> what actually happened. **Identity check, not authentication** — the
> accepting user's claimed email is checked against the invitation's own;
> neither `userId` nor `email` is verified against any session/auth
> system (none exists; Section 13 prohibits introducing one), and a
> mismatch returns a bare `ForbiddenError` rather than a sixth dedicated
> error type. **`inviteMember` gains inviter authorization** (Section
> 8) — a new `canInviteAs` helper (`OWNER`→`ADMIN`/`MEMBER`,
> `ADMIN`→`MEMBER` only, nobody→`OWNER`), closing the gap E05-T06's own
> docs flagged as open; the inviter's membership must also be `ACTIVE` (a
> judgment call beyond Section 3's literal wording). Added
> `MembershipRepository.findByUserId`/`existsActive`/`save`.
> **Deliberately did not add `InvitationRepository.findPendingById`** —
> `acceptInvitation` needs the invitation's actual status to distinguish
> "not found" from "not pending"; the existing `findById` is used
> instead. Added `INVITATION_ACCEPTED_EVENT`/`INVITATION_EXPIRED_EVENT`
> wire contracts, and **fixed `MemberJoinedPayload.role`** from a
> lowercase T01-era placeholder to the real, uppercase `MembershipRole`
> values (first actual publisher, so no shipped behavior changes). Full
> detail: [accept-invitation-usecase.md](../modules/accept-invitation-usecase.md).
> Tenancy package tests 270→294 (+24 — 15 in a new
> `accept-invitation.test.ts`, +8 in `invite-member.test.ts`'s new
> authorization matrix, +1 in the existing `index.test.ts` smoke test;
> 19→20 files). Full build/typecheck/lint/test/architecture-fitness/
> export-snapshot gate green repo-wide (architecture-fitness unchanged at
> 36). Prior update: **2026-07-30** — **E05-T06 (`inviteMember` use
> case) complete**: the second real application service in
> `@corestack/tenancy`, following `createOrganization` (E05-T03)'s
> orchestration standard — coordinates the `Organization` aggregate, the
> `Invitation` aggregate (E05-T05), `OrganizationRepository`,
> `InvitationRepository`, and `UnitOfWork` event publication.
> `InviteMemberCommand`/`InviteMemberResult` (a DTO, never the aggregate),
> `CannotInviteOwnerError` (fails before aggregate construction — defense
> in depth against `Invitation.create`'s own generic rejection),
> `InvitationAlreadyExistsError` (on a pending duplicate: no aggregate,
> no persistence, no event). **`ForbiddenError`** on a client-claimed
> `organizationId` mismatch against `context.organizationId` — firmer
> than E05-T03's still-open `requestedBy`-vs-`context.actor.id` question,
> since `organizationId` is exactly the value tenant isolation depends
> on. Added `existsPendingForEmail`/`save` to `InvitationRepository`.
> Added `tenancyConfigSpec.invitationExpiryDays` (default 7, actually
> read); the pre-existing `invitationExpiryHours` (E05-T01, default 72,
> never read by any code) is left in place, explicitly marked
> superseded-but-not-removed. Added `INVITATION_CREATED_EVENT`/
> `InvitationCreatedPayload` — the first `INVITATION_*` wire contract in
> the package. **Skipped the active-membership check** (no `User`
> aggregate/repository exists anywhere in this codebase to map an
> invitee's email to a `userId` — genuinely unrepresentable today).
> Full detail:
> [invite-member-usecase.md](../modules/invite-member-usecase.md).
> Tenancy package tests 254→270 (+16 — 15 in a new
> `invite-member.test.ts`, +1 in the existing `index.test.ts` smoke test;
> 18→19 files). Full build/typecheck/lint/test/architecture-fitness/
> export-snapshot gate green repo-wide (architecture-fitness unchanged at
> 36). Prior update: **2026-07-30** — **E05-T05 (`Invitation` domain
> model) complete**: the third real business aggregate, following
> `Organization` (E05-T02)/`Membership` (E05-T04)'s modelling standard
> exactly. `InvitationId` (own value object), `OrganizationId`/`UserId`
> (reused from E05-T02/T04), and a temporary tenancy-local `Email` value
> object (no shared identity/contact module exists in this repo —
> confirmed by search). `InvitationRole` (`ADMIN`/`MEMBER` only — no
> `OWNER`, runtime-validated since the role typically originates from
> external input) and `InvitationStatus`
> (`PENDING`/`ACCEPTED`/`REVOKED`/`EXPIRED` — `PENDING` the only mutable
> state, the other three terminal, none transitioning to any other).
> Explicit methods (`create`/`accept`/`revoke`/`expire`), domain events
> collected via `pullDomainEvents()`/`clearDomainEvents()` — same local
> pattern, no shared `AggregateRoot`. **No token field** — unlike the
> E05-T01 scaffold's placeholder `InvitationRecord`, which had one — token
> generation/hashing/delivery are explicitly domain-external concerns.
> `expiresAt` must be strictly after `now` at creation; neither `expire()`
> nor `accept()` compares `now` against `expiresAt` on the terminal call
> itself, documented explicitly for both so a future `AcceptInvitation`
> use case doesn't accept a stale invitation by omission. Full detail:
> [invitation-domain.md](../modules/invitation-domain.md). Tenancy package
> tests 171→254 (+83 — 82 across 5 new files, +1 in the existing
> `index.test.ts` smoke test; 13→18 files). Full build/typecheck/lint/
> test/architecture-fitness/export-snapshot gate green repo-wide
> (architecture-fitness unchanged at 36). Mechanically updated
> `InvitationRepository` to return `Invitation` instead of the superseded
> `InvitationRecord` placeholder — the same forced fix
> `OrganizationRepository`/`MembershipRepository` went through in
> E05-T02/T04. Prior update: **E05-T04 (`Membership` domain
> model) complete**: the second real business aggregate, following
> `Organization` (E05-T02)'s modelling standard exactly. `MembershipId`
> (own value object), `OrganizationId` (reused, not reimplemented), and a
> temporary tenancy-local `UserId` value object (no shared identity module
> exists in this repo — confirmed by search, flagged for deletion once one
> does). `MembershipRole` (`OWNER`/`ADMIN`/`MEMBER`) and `MembershipStatus`
> (`ACTIVE`/`SUSPENDED`/`REMOVED`, `REMOVED` terminal), each with its own
> transition table. Explicit methods (`create`/`promoteToAdmin`/
> `demoteToMember`/`suspend`/`reactivate`/`remove`), domain events
> collected via `pullDomainEvents()`/`clearDomainEvents()` — same local
> pattern as `Organization`, no shared `AggregateRoot`. Owner is
> structurally locked against promotion/demotion (role transition table
> has no outgoing `OWNER` entries) and against removal (`remove()` checks
> the role explicitly before the status table) — ownership transfer is an
> explicitly open future use case. Full detail:
> [membership-domain.md](../modules/membership-domain.md). Tenancy package
> tests 94→171 (+77 — 75 across 5 new files, +2 backfilled into the
> existing `index.test.ts` smoke test, one of which covers E05-T03's
> `createOrganization` export that task's own update missed; 8→13 files).
> Full build/typecheck/lint/test/
> architecture-fitness/export-snapshot gate green repo-wide
> (architecture-fitness unchanged at 36). Mechanically updated
> `MembershipRepository` to return `Membership` instead of the superseded
> `MembershipRecord` placeholder — the same forced fix
> `OrganizationRepository` went through in E05-T02. Prior update:
> **E05-T03 (`createOrganization` use case) complete**: the first real
> application service in `@corestack/tenancy` — coordinates the
> `Organization` aggregate, `OrganizationRepository`, and `UnitOfWork`
> event publication; contains no domain rules of its own.
> `CreateOrganizationCommand`/`CreateOrganizationResult` (a DTO, never the
> aggregate), `DuplicateSlugError`. Whole flow (uniqueness check,
> aggregate creation, persistence, event publication) runs inside one
> `UnitOfWork.run()` call; depends on the generic kernel `UnitOfWork`, not
> `PostgresUnitOfWork` — no infrastructure coupling. Full detail:
> [create-organization-usecase.md](../modules/create-organization-usecase.md).
> Tenancy package tests 79→94 (+15; 7→8 files). Fixed
> `OrganizationCreatedPayload` (E05-T01): dropped the `kind` field, which
> the `Organization` aggregate has no equivalent of and could never
> actually supply — the wire contract follows the domain model, not the
> reverse. Two things flagged, not resolved: `existsBySlug` is a
> best-effort duplicate check, not a durable uniqueness guarantee, until
> E05-T21 adds a unique index; and `requestedBy`/`requestId` are validated
> but not yet consumed (no owner `Membership` created, no idempotency
> wiring) — both are `createOrganization`'s own non-goals, not silent
> gaps. Prior update: **E05-T02 (Organization domain model)
> complete**: pure domain aggregate — `OrganizationId`/`OrganizationSlug`
> value objects, `OrganizationStatus` (3 states, `DELETED` terminal),
> explicit methods (`create`/`rename`/`suspend`/`reactivate`/`delete`),
> domain events collected via `pullDomainEvents()`/`clearDomainEvents()`.
> Superseded the E05-T01 placeholder `OrganizationRecord`. One open
> reconciliation flagged, not resolved: this task's 3-state status model
> and no `kind` field vs. `tenancy-contract.md`'s 4-state
> (`pending_deletion`/`purged`) blueprint reference — tracked in
> organization-domain.md's non-goals for whichever future task
> (E05-T13/T21) needs to decide. Prior update:
> **E05-T01 (Tenancy module scaffold) complete**: new `@corestack/tenancy`
> package — module factory, 3 repository ports (contract-only), event
> contracts, a `ModuleConfigSpec` with defaults, a schema-only migration.
> Found and documented one confirmed platform-framework limitation along
> the way (`ModuleConfigSpec<T>` cannot express an optional or coerced
> config field under this repo's `exactOptionalPropertyTypes`) — resolved
> module-locally, recorded in
> [e05-readiness-friction-log.md](../engineering/e05-readiness-friction-log.md).
> Prior update: **E05 Readiness Gate complete,
> verdict GO** (full report:
> [e05-readiness-gate-report.md](../engineering/e05-readiness-gate-report.md);
> friction log:
> [e05-readiness-friction-log.md](../engineering/e05-readiness-friction-log.md);
> tenancy contract:
> [tenancy-contract.md](../modules/tenancy-contract.md); alpha release prep
> under `docs/releases/v0.1.0-alpha.1-*`, prepared not published). Export-
> surface snapshot gap closed (5/5 conditions gated); 3 of 4 previously-
> unproven contract suites gained mutation proof (`UnitOfWork` deliberately
> deferred, reasoned); `CONTRIBUTING.md` now links the mandatory tenant-
> safety guide and corrects a stale Docker-only integration-test claim.
> Prior update: **2026-07-29** (**E03 COMPLETE** — 21 of 22 tasks;
> outbox epic T02-T03, T10-T14 done; Infrastructure Consolidation pass complete;
> migrated local dev/test to PostgreSQL 18 — see
> [postgres-18-compatibility.md](../platform/postgres-18-compatibility.md);
> T23 health/readiness done — see
> [health-readiness.md](../../packages/platform/docs/health-readiness.md);
> T30 RLS harness done — see
> [tenant-isolation.md](../../packages/platform/docs/tenant-isolation.md);
> T31 org-scoped repository base done — see
> [org-scoped-repository.md](../../packages/platform/docs/org-scoped-repository.md);
> T33 purge protocol framework done — see
> [purge-protocol.md](../../packages/platform/docs/purge-protocol.md);
> T40 Postgres UnitOfWork done (ADR-0017: Drizzle deferred) — see
> [unit-of-work.md](../../packages/platform/docs/unit-of-work.md);
> T41 Postgres RateLimiter done — see
> [rate-limiter.md](../../packages/platform/docs/rate-limiter.md);
> T42 CachePort decision done (ADR-0018: no Postgres backend, Redis
> deferred) — see
> [ADR-0018](../adr/0018-cache-no-postgres-backend-redis-deferred.md);
> **E03 now COMPLETE**: T43 Postgres IdempotencyStore adapter done
> (ADR-0019 added the `IdempotencyStore` port to the kernel, a blueprint
> prerequisite gap) — see
> [idempotency-key-store.md](../../packages/platform/docs/idempotency-key-store.md).
> Full epic-exit Engineering Health Report — see
> [E03-exit-report.md](../engineering/reviews/E03-exit-report.md).
> **Tenant Isolation Certification complete (2026-07-29)**: verdict
> CERTIFIED WITH RESIDUAL RISKS — see
> [tenant-isolation-certification.md](../security/tenant-isolation-certification.md),
> [security-scorecard.md](../security/security-scorecard.md), and
> [v0.1.0-alpha-readiness.md](../releases/v0.1.0-alpha-readiness.md). Found
> and fixed a real cross-tenant vulnerability (ADR-0020); added
> `GlobalRepository` + two architecture-fitness rules (ADR-0021); shipped
> the golden-path `examples/acme-crm-module` and a mandatory contributor
> safety guide). **E04-T01 contract-suite framework done** (2026-07-29):
> `@corestack/kernel/testing` — see
> [contract-suite-framework.md](../../packages/kernel/docs/contract-suite-framework.md).
> Cache/RateLimiter suites proven against both kernel's in-memory adapters
> and platform's real `PostgresRateLimiter`; zero added runtime
> dependencies (type-only vitest import). **All 7 founder-directed
> contract suites complete** (2026-07-29, T03–T09: Logger, EventBus,
> UnitOfWork, Encrypter, ProcessedEventStore, Health-check snapshots,
> IdempotencyStore) — two real bugs found and fixed along the way
> (ADR-0022 Logger runtime redaction/error serialization; a UUID-vs-
> readable-id bug caught by the ProcessedEventStore suite itself before
> shipping). E04-T02 (Testcontainers) remains an explicit external-
> environment blocker (no Docker), not attempted. Full record:
> [contract-governance.md](../testing/contract-governance.md),
> [adapter-certification-matrix.md](../testing/adapter-certification-matrix.md).
> **E04 Consolidation and Release-Hardening Mode complete (2026-07-29)**:
> [contract-coverage-audit.md](../testing/contract-coverage-audit.md) names,
> honestly, which suites have real mutation proof (Logger, ProcessedEventStore,
> IdempotencyStore's ADR-0020 case) vs. relocation-only (Cache, RateLimiter,
> Encrypter, UnitOfWork; EventBus partial) — see Test & coverage below. A
> repo-wide duplicate-test sweep found zero additional duplicates beyond
> what the T03–T09 conversions already removed.
> [snapshot-governance.md](../testing/snapshot-governance.md) codifies
> what may/must-never be snapshotted; both existing snapshot files audited
> as compliant. [performance/README.md](performance/) consolidates every
> baseline across both benchmark directories.
> [testcontainers-readiness.md](../testing/testcontainers-readiness.md)
> prepares E04-T02 with no runtime code, confirming its real scope is
> Postgres-only (no Redis/MinIO adapter exists to need one).
> [export-surface-audit.md](../releases/export-surface-audit.md) found and
> fixed two stale docs (kernel's package description, platform's README
> test counts) and named a real gap: only kernel's main entry has an
> export-surface snapshot — kernel's `./testing` subpath and all three of
> platform's conditions are ungated.
> [how-to-add-a-new-adapter.md](../contributing/how-to-add-a-new-adapter.md)
> is now the canonical 7-step contributor workflow. Full verdict:
> [e04-completion-report.md](../engineering/e04-completion-report.md) —
> **E04 complete except the external Docker blocker**.

## Standing policy

**No new features while unresolved P0 findings exist.** (Governance §7.4 —
anchored here; also stated in CONTRIBUTING.) Current P0 count is the gate.
**Platform Maturity Mode is active:** the kernel is stability-first; every
infrastructure component built from E03 onward ships as a documented
product (contract, failure modes, retry/timeout/cancellation, concurrency,
performance, security, observability scoping) — see
[packages/platform/docs/migration-loader.md](../../packages/platform/docs/migration-loader.md)
for the first instance of this standard.

## Findings

| Severity | Open                      | Resolved | Notes                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | **0**                     | 5        | AUD-01…04 — see [remediation log](remediation-log.md); **+1** cross-tenant idempotency-key replay found and fixed during the Tenant Isolation Certification, never exposed to a real caller — see ADR-0020                                                                            |
| **P1**   | 1 _(scheduled by design)_ | 6        | AUD-07 is a _decision deferred to E06 design_ (auth limiter algorithm), not an unfixed defect                                                                                                                                                                                         |
| **P2**   | 9 _(6 mapped + 3 new)_    | 2        | AUD-12→E01-T02.4, AUD-13 done, AUD-14/15/16/18/19 tracked; **+3 new** from the outbox security review — checkpoint-table privilege separation, no per-handler timeout, no admin-action audit log (none externally exploitable — see [outbox-review.md](../security/outbox-review.md)) |

## Test & coverage

| Metric               | Value                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test files / tests   | **Unit/application lanes** (what `pnpm -r test` runs): 82 files / **831 tests**, re-measured 2026-07-31 — kernel 9/114 · lint fixtures 2/15 · architecture fitness 5/36 · platform 24/197 · example module 2/3 · **tenancy 40/466** (up from 37/450, +3 files/+16 tests — E05-T14: 7 pure event→work-item mapping tests, 2 subscription-shape/ignored-event tests, 7 migration/RLS-consistency tests). **Integration lanes** (separate command, unmeasured this run except where noted): platform 14 files/97 tests, example module 1/4, **tenancy 1 file/41 tests** (up from 34, E05-T14 — 7 new invitation-notification-consumer tests: created→`PENDING` work item, duplicate delivery→no duplicate row, accepted/expired→null-recipient work items, replay safety, transaction rollback safety, `MEMBER_JOINED` ignored end-to-end; `pnpm test:integration` against real PostgreSQL 18). Architecture-fitness stayed at 5/36 (E05-T14 added no new fitness test, only a `GlobalRepository` marker + ADR-0026 satisfying an existing rule) |
| Kernel coverage (v8) | **98.25% stmts · 97.98% branch · 91.48% funcs** (target ≥90% domain/application — met)                                                                        |
| Platform coverage    | Not yet measured — arrives with the coverage-gate task (E04-T11)                                                                                               |
| Coverage CI gate     | Not yet enforced (E04-T11) — tracked, honest                                                                                                                   |
| Unit-suite duration  | ~1 s repo-wide on cache hit (budget < 30 s)                                                                                                                    |
| Contract suites      | **8** — Cache, RateLimiter, Logger, EventBus, UnitOfWork, Encrypter, ProcessedEventStore, IdempotencyStore (Health-check is deliberately not a 9th — snapshot-tested instead, see matrix) |
| Certified adapters   | **13** of 13 existing adapters certified against their port's suite (every un-certified pairing is an adapter that doesn't exist yet — pino `Logger`, KMS `Encrypter` — correctly `pending`, not missing) — see [adapter-certification-matrix.md](../testing/adapter-certification-matrix.md) |
| Snapshot count       | **4 files / 12 snapshots** (2026-07-30, up from 4/11) — kernel's `api-surface.test.ts` (2: `.` and `./testing` export lists) + platform's `api-surface.test.ts` (3: `.`, `./postgres`, `./testing`) + platform's `health-readiness.test.ts` (3, payload shapes) + tenancy's `api-surface.test.ts` (4, up from 3: `.`, `./postgres`, `./testing`, and `./interface` — new in E05-T13; `./testing` snapshots `[]` — reserved, empty by design). All declared export conditions across kernel/platform/tenancy now gated — see [snapshot-governance.md](../testing/snapshot-governance.md) |
| Mutation-proven rules | **6 of 8 suites** (2026-07-30, up from 3) have on-record proof an assertion catches a real regression — Logger (ADR-0022), ProcessedEventStore (UUID bug), IdempotencyStore (historical ADR-0020 case), and, added by the E05 readiness gate, Cache (`NeverExpiringCache`), RateLimiter (`LexicographicRateLimiter`, reproducing E03-T41's real string-comparison bug), Encrypter (`FixedIvEncrypter`, reused-IV) — plus EventBus partial (1 of ~8 assertions) and the adapter-matrix fitness rule. `UnitOfWork` alone remains without mutation proof — a **deliberate deferral** (no plausible silent-mistake fixture exists for its assertions), not an oversight — see [contract-coverage-audit.md](../testing/contract-coverage-audit.md) |
| Performance baselines | **10** scripts total across two directories — 6 outbox subsystem + 4 E04 contract-suite adapters (RateLimiter, IdempotencyStore, ProcessedEventStore, UnitOfWork); none CI-gated, deferred to E04-T13 — see [performance/README.md](performance/) |

## Architecture & API

| Metric                      | Value                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| ADRs accepted               | **22** (0001–0022)                                                                                                                           |
| Architecture fitness tests  | **Live in CI**: layer boundaries (lint zones + fixtures), import cycles, cross-package boundaries, manifest/ADR compliance, kernel zero-deps, tenant-isolation rules (ADR-0021), contract-suite adapter matrix |
| Public API stability        | Kernel runtime surface snapshot-gated; full type-level report at E19-T14                                                                     |
| Kernel runtime dependencies | **0** (fitness-test-enforced)                                                                                                                |

## CI health

| Gate                  | Status                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Silent-success guards | ✅ `assert-turbo-tasks` on `test` (min 3) and `test:integration` (exact manifest — now non-trivially exercised: `@corestack/platform`, `@corestack/example-acme-crm-module`)  |
| Integration lane      | ✅ Live: Testcontainers-based in CI (no fixed service container needed); dual-mode locally — a local Postgres via `DATABASE_URL` or Testcontainers, same test code either way |
| Actions supply chain  | ✅ All actions SHA-pinned; Renovate `pinDigests` maintains                                                                                                                    |
| Release pipeline      | ⏸ Gated on `RELEASE_ENABLED` repo variable (awaiting npm org + token — external)                                                                                              |
| Dependency audit      | Scheduled lane (weekly + main), not PR-blocking (AUD-13 rationale)                                                                                                            |

## Benchmarks

Kernel hot paths: none yet — harness arrives E04-T13; hot-path budgets
(≤5 ms session/policy p95) become CI-gated then.

**Outbox subsystem:** first real baseline captured 2026-07-28 against a
local PostgreSQL 18.4 instance — six scripts under
`packages/platform/bench/` (`writeOutboxEvents` 4.24ms mean, relay
polling 4.80ms, relay dispatch 0.95ms in-memory, checkpoint updates
1.66ms, processed-event inserts 1.39ms, partition maintenance 3.56ms).
**Not CI-gated, no thresholds** — same posture as the kernel, deferred to
E04-T13. See
[outbox-benchmark-methodology.md](architecture-benchmarks/outbox-benchmark-methodology.md)
and [baselines/outbox/](architecture-benchmarks/baselines/outbox/).

**Contract-suite adapters (E04):** first baseline captured 2026-07-29,
same local instance — four scripts covering the newly-certified
Postgres adapters (`PostgresRateLimiter.consume` 0.35ms mean,
`PostgresIdempotencyStore.begin` 0.34ms, `PostgresProcessedEventStore
.markProcessed` 0.30ms, `PostgresUnitOfWork.run` 0.74ms — the only one of
the four opening a full transaction). Also **not CI-gated, no
thresholds**, deferred to E04-T13. See
[contract-suite-adapter-benchmark-methodology.md](performance/contract-suite-adapter-benchmark-methodology.md)
and [docs/quality/performance/](performance/).

## Technical debt register (must be zero or justified)

| Item                                                                                                                                                   | Justification                                                                                              | Retires at           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------- |
| Type-level API report deferred                                                                                                                         | Runtime snapshot covers surface pre-1.0; api-extractor tooling costs unjustified before freeze             | E19-T14              |
| Coverage not CI-gated                                                                                                                                  | Gate lands with the test-infrastructure epic                                                               | E04-T11              |
| `/contracts` types-only rule enforced structurally, not type-level                                                                                     | Fitness test blocks runtime deep-imports; full types-only proof needs the first contracts subpath to exist | E01-T02.4 (E05 gate) |
| E03-T04 (migration authoring guide) never built                                                                                                        | Found at E03 exit review; low complexity (S/1d, DOC), not blocking any other epic                          | Unscheduled          |
| Platform's own tables (`outbox`, `rate_limits`, `idempotency_keys`) bootstrap via `ensure*Schema` application code, not T02's tracked migration runner | No incident yet (no shape changes since shipping); no drift detection if one ever changes                  | Unscheduled          |
| No export-surface snapshot for kernel's `./testing` subpath or any of platform's 3 conditions | Only kernel's main entry (`.`) is gated; an accidental rename/removal on the other 4 conditions has no automated signal — see [export-surface-audit.md](../releases/export-surface-audit.md) | Unscheduled — small, mechanical addition, natural first E04-follow-up task |
| 4 of 8 contract suites (Cache, RateLimiter, Encrypter, UnitOfWork) have no mutation proof; EventBus only partial | Relocated from already-passing tests; no observed pre-fix failure or broken fixture on record for these — see [contract-coverage-audit.md](../testing/contract-coverage-audit.md) | Unscheduled — closing this retroactively is real follow-up work under Section 12's proposed permanent policy |
| `manifest-rules.test.mjs` checks export-condition ordering only, not that declared `dist/` targets actually exist/resolve | Verified manually for this audit (all 5 conditions resolve); no regression today, but a future misconfigured subpath would only fail at consumer-import time | Unscheduled |
| `ModuleConfigSpec<T>.schema`'s `ZodType<T>` type can't express an optional or coerced config field under `exactOptionalPropertyTypes` (confirmed empirically building tenancy's config spec, E05-T01) | Worked around module-locally (required-string fields + an `EnvSource`-level defaulting wrapper); relaxing the platform type is a deliberate future decision with cross-module blast radius, not a fix to smuggle into a module task — see [e05-readiness-friction-log.md](../engineering/e05-readiness-friction-log.md) | Unscheduled |

## Documentation coverage

All 21 ADRs current · design docs (architecture/database/api) versioned ·
5 guide structures approved · overview.md reconciled (AUD-11) ·
docs drift-check joins every epic-exit checklist (AUD-19). **E03 exit
review complete (2026-07-29)** — see
[E03-exit-report.md](../engineering/reviews/E03-exit-report.md) and the
epic's two lessons-learned files
([outbox](../engineering/lessons/e03-outbox-epic.md),
[tenant isolation & adapters](../engineering/lessons/e03-tenant-isolation-and-adapters.md));
this pass caught and fixed two stale docs (`outbox-architecture.md`'s
T40 status, a stale code comment about `Sql`/`TransactionSql` typing) and
one never-built task (E03-T04, now tracked debt above). Outbox
subsystem consolidated (2026-07-28): end-to-end architecture map with
sequence diagram, operational runbook, security review, observability
contract, and health/readiness contract — see
[E03-outbox-milestone-report.md](../engineering/reviews/E03-outbox-milestone-report.md)
for the full index. Two stale cross-references caught and fixed in the
same pass (E03-entry-review.md's runbook path; several component specs'
Testcontainers-only test framing, once local Postgres 18 became a second
mode). PostgreSQL 18 compatibility verified empirically — see
[postgres-18-compatibility.md](../platform/postgres-18-compatibility.md).
**E04 Consolidation and Release-Hardening Mode complete (2026-07-29)**: 6
new docs — contract coverage audit, snapshot governance, consolidated
performance README, Testcontainers readiness, export-surface audit, and
the contributor "how to add a new adapter" guide (full index in the header
note above). Two stale docs found and fixed in the same pass (kernel's
`package.json` description omitted 2 shipped ports; platform's README
scorecard cited pre-E04 test counts).

## Infrastructure maturity

**79/100** as of the E03 epic-exit re-score (2026-07-29), covering the
whole epic — RLS/org-scoping, composition root, health/readiness,
graceful shutdown, and all four Postgres adapters — not just the outbox
subsystem the prior 83/100 scored. Scored per-dimension (contract
completeness, test rigor, operational readiness, security posture,
performance visibility, documentation coherence) in
[E03-exit-report.md §5](../engineering/reviews/E03-exit-report.md). The
outbox-only 83/100 (2026-07-28,
[E03-outbox-milestone-report.md §6](../engineering/reviews/E03-outbox-milestone-report.md))
remains historically accurate for that narrower scope; the drop isn't a
regression, it's a wider, less-weathered surface being scored honestly for
the first time. Held back mainly by operational tooling maturity (runbook
procedures like replay are manual SQL, not yet a built API) and
performance visibility (a baseline exists only for outbox hot paths; T30/T31/T33/T40/T41/T43's
Postgres operations are proven correct under concurrency but unbenchmarked).
