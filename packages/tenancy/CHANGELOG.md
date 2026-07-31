# @corestack/tenancy

## 0.0.1

### Initial scaffold (E05-T01)

- Module scaffold only: package manifest, `createTenancyModule` factory
  (registers a purge subscription, a static health stub, no use cases yet),
  repository ports (`OrganizationRepository`, `MembershipRepository`,
  `InvitationRepository`), tenancy event contracts (types only, no
  publishing), `tenancyConfigSpec`, and a schema-only migration.
- No aggregates, no commands, no persistence, no HTTP interface. See the
  package [README](./README.md#what-is-intentionally-not-implemented) for
  the complete list of what this release deliberately does not include.

### Organization domain model (E05-T02)

- `Organization` aggregate: pure domain model, no persistence/I/O.
  `OrganizationId`/`OrganizationSlug` value objects, `OrganizationStatus`
  (`ACTIVE`/`SUSPENDED`/`DELETED`, `DELETED` terminal), explicit methods
  (`create`/`rename`/`suspend`/`reactivate`/`delete`), domain events
  (`OrganizationCreated`/`Renamed`/`Suspended`/`Reactivated`/`Deleted`)
  collected via `pullDomainEvents()`/`clearDomainEvents()`. Full detail:
  [docs/modules/organization-domain.md](../../docs/modules/organization-domain.md).
- Superseded the E05-T01 placeholder `OrganizationRecord`; updated
  `OrganizationRepository`'s port signatures to return the real
  `Organization` aggregate.
- No `Membership`/`Invitation` aggregates, no commands, no persistence —
  still out of scope.

### `createOrganization` use case (E05-T03)

- The first real application service: coordinates the `Organization`
  aggregate, `OrganizationRepository`, and `UnitOfWork` event publication.
  `CreateOrganizationCommand`/`CreateOrganizationResult` (a DTO, never the
  aggregate), `DuplicateSlugError` (extends `ConflictError`). Whole flow —
  uniqueness check, aggregate creation, persistence, event publication —
  runs inside one `UnitOfWork.run()` call. Depends on the generic kernel
  `UnitOfWork`, not `PostgresUnitOfWork` — no infrastructure coupling.
  15 new tests, in-memory test doubles only. Full detail:
  [docs/modules/create-organization-usecase.md](../../docs/modules/create-organization-usecase.md).
- Added `existsBySlug`/`save` to `OrganizationRepository` (plain `Context`,
  not `OrgScopedContext` — creating an org is necessarily pre-org-scope).
- Fixed `OrganizationCreatedPayload` (E05-T01): dropped the `kind` field,
  which the `Organization` aggregate (E05-T02) has no equivalent of and
  could never actually supply.
- **Not a hard slug-uniqueness guarantee** — `existsBySlug` is best-effort
  until E05-T21 adds a unique index. No `Membership` creation (the
  contract doc's "org + owner membership atomically" isn't built here).
  Not wired into `createTenancyModule`'s `useCases`.

### `Membership` domain model (E05-T04)

- `Membership` aggregate: pure domain model, no persistence/I/O.
  `MembershipId` value object (new), `OrganizationId` reused from
  E05-T02, and a temporary, tenancy-local `UserId` value object (no
  shared identity module exists in this repo yet — flagged for deletion
  once one does). `MembershipRole` (`OWNER`/`ADMIN`/`MEMBER`) and
  `MembershipStatus` (`ACTIVE`/`SUSPENDED`/`REMOVED`, `REMOVED` terminal).
  Explicit methods (`create`/`promoteToAdmin`/`demoteToMember`/`suspend`/
  `reactivate`/`remove`), domain events
  (`MembershipCreated`/`Promoted`/`Demoted`/`Suspended`/`Reactivated`/
  `Removed`) collected via `pullDomainEvents()`/`clearDomainEvents()`.
  Full detail:
  [docs/modules/membership-domain.md](../../docs/modules/membership-domain.md).
- Owner is structurally locked: cannot be promoted/demoted (the role
  transition table has no outgoing entries for `OWNER`) and cannot be
  removed (`remove` checks the role explicitly, before the status
  transition table). Ownership transfer is an explicitly open, future
  use case — not implemented.
- Mechanically updated `MembershipRepository`'s two methods to return
  `Membership` instead of the superseded `MembershipRecord` placeholder —
  the same forced fix `OrganizationRepository` went through in E05-T02.
- 5 new test files, 77 new tests (tenancy package: 94→171 total; 8→13
  files) — 75 across the new files, plus 2 backfilled into the existing
  `index.test.ts` export smoke test: one for `Membership`'s exports (this
  task) and one for `createOrganization`'s exports, which E05-T03's own
  smoke-test update missed. No repositories, no use cases, no invitation
  flows — all explicitly out of scope per this task's founder directive.

### `Invitation` domain model (E05-T05)

- `Invitation` aggregate: pure domain model, no persistence/I/O.
  `InvitationId` value object (new), `OrganizationId`/`UserId` reused
  from E05-T02/T04, and a temporary, tenancy-local `Email` value object
  (no shared identity/contact module exists in this repo — flagged for
  deletion once one does). `InvitationRole` (`ADMIN`/`MEMBER` only — no
  `OWNER`, runtime-validated via `assertValidInvitationRole` since the
  role typically originates from external input) and `InvitationStatus`
  (`PENDING`/`ACCEPTED`/`REVOKED`/`EXPIRED` — `PENDING` the only mutable
  state, the other three all terminal). Explicit methods
  (`create`/`accept`/`revoke`/`expire`), domain events
  (`InvitationCreated`/`Accepted`/`Revoked`/`Expired`) collected via
  `pullDomainEvents()`/`clearDomainEvents()`. Full detail:
  [docs/modules/invitation-domain.md](../../docs/modules/invitation-domain.md).
- **No token field.** Unlike the E05-T01 scaffold's placeholder
  `InvitationRecord` (which had a bare `tokenHash` field), this aggregate
  has none — token generation, hashing, and delivery are explicitly
  domain-external concerns (Section 13/14), left for a future
  application/infrastructure task.
- `expiresAt` must be strictly after `now` at creation; `expire()` itself
  does not compare `now` against `expiresAt` (a policy decision left to
  the future caller that decides an invitation has actually expired) —
  and the same is true of `accept()`, documented explicitly so a future
  `AcceptInvitation` use case doesn't accept a stale `PENDING` invitation
  by omission.
- Mechanically updated `InvitationRepository`'s two methods to return
  `Invitation` instead of the superseded `InvitationRecord` placeholder —
  the same forced fix `OrganizationRepository`/`MembershipRepository`
  went through in E05-T02/T04.
- 5 new test files, 83 new tests (tenancy package: 171→254 total; 13→18
  files) — 82 across the new files, plus 1 in the existing
  `index.test.ts` export smoke test. No repositories, no use cases, no
  invitation tokens/delivery/acceptance workflow — all explicitly out of
  scope per this task's founder directive.

### `inviteMember` use case (E05-T06)

- The second real application service: coordinates the `Organization`
  aggregate, the `Invitation` aggregate, `OrganizationRepository`,
  `InvitationRepository`, and `UnitOfWork` event publication.
  `InviteMemberCommand`/`InviteMemberResult` (a DTO, never the
  aggregate), `CannotInviteOwnerError` (extends `ValidationError`),
  `InvitationAlreadyExistsError` (extends `ConflictError`). Whole flow —
  organization lookup, duplicate-pending check, aggregate creation,
  persistence, event publication — runs inside one `UnitOfWork.run()`
  call. 15 new tests, in-memory test doubles only. Full detail:
  [docs/modules/invite-member-usecase.md](../../docs/modules/invite-member-usecase.md).
- **`ForbiddenError` on a client-claimed `organizationId` mismatch.**
  `inviteMember` takes `context: OrgScopedContext` as its first
  parameter; `command.organizationId` is parsed and checked for exact
  equality against `context.organizationId` — a mismatch is an
  authorization signal, not malformed input, and is rejected outright
  (firmer than E05-T03's still-open `requestedBy`-vs-`context.actor.id`
  question, because `organizationId` is exactly the value tenant
  isolation depends on).
- Added `existsPendingForEmail`/`save` to `InvitationRepository` (takes
  `OrgScopedContext`, unlike `OrganizationRepository`'s pre-org-scope
  `existsBySlug`/`save` — by the time an invitation is created, an
  organization already exists).
- Added `tenancyConfigSpec.invitationExpiryDays` (default 7), read by
  `inviteMember` together with an injected `Clock` to compute
  `expiresAt`. The pre-existing `invitationExpiryHours` (E05-T01, default
  72) is left in place, unread by any code, explicitly marked in
  `config.ts` as superseded-but-not-removed — repurposing it would have
  silently changed a shipped, documented default, which this task was
  never asked to do.
- Added `INVITATION_CREATED_EVENT`/`InvitationCreatedPayload` to
  `application/events.ts` — the first `INVITATION_*` wire contract in
  this package (E05-T01 defined only organization/member contracts).
  `role` is typed `"ADMIN" | "MEMBER"` against the real `InvitationRole`
  values, deliberately not perpetuating `MemberJoinedPayload.role`'s
  lowercase T01 mismatch; `expiresAt` is a JSON-serializable ISO string.
- **Skipped the active-membership check (Section 4 step 2).** No
  `User` aggregate or repository exists anywhere in this codebase to map
  an invitee's email to a `userId`, so `Membership`'s `userId`-keyed
  lookup cannot answer "is this email already an active member" —
  genuinely unrepresentable today, not a convenience shortcut.
  `InviteMemberDeps` has no `membershipRepository` field.
- **Does not check whether the inviter is authorized to invite** — no
  membership/role check on `invitedBy` itself. Flagged as an open
  authorization gap, expected to be closed at the HTTP/policy layer or a
  future task.
- 1 new test file, 15 new tests, plus 1 backfilled into the existing
  `index.test.ts` export smoke test (tenancy package: 254→270 total;
  18→19 files). No repository adapters, no SQL, no RLS, no migrations,
  no HTTP handlers, no email delivery, no invitation acceptance — all
  explicitly out of scope per this task's founder directive.

### `acceptInvitation` use case + `inviteMember` authorization (E05-T07)

- The third real application service: `acceptInvitation`, the
  membership-admission workflow. Coordinates the `Invitation` and
  `Membership` aggregates, `InvitationRepository`, `MembershipRepository`,
  and `UnitOfWork` event publication. `AcceptInvitationCommand`/
  `AcceptInvitationResult` (a DTO, never either aggregate),
  `InvitationNotFoundError` (extends `NotFoundError`),
  `InvitationExpiredError`/`InvitationNotPendingError`/
  `MembershipAlreadyExistsError` (extend `ConflictError`),
  `InviterNotAuthorizedError` (extends `ForbiddenError`, consumed by
  `inviteMember` — see below). 15 new tests, in-memory test doubles
  only. Full detail:
  [docs/modules/accept-invitation-usecase.md](../../docs/modules/accept-invitation-usecase.md).
- **Expiry enforcement moved to acceptance time.** `Invitation.expire()`
  (E05-T05) never compares `now` against `expiresAt` itself —
  `acceptInvitation` is the first caller that does. Discovering an
  expiry is not a no-op rejection: the `EXPIRED` transition is persisted
  and its event published *before* `InvitationExpiredError` is returned,
  since the invitation's stored state must reflect what actually
  happened.
- **Identity check, not authentication.** The accepting user's claimed
  email (`command.email`) is checked for equality against the
  invitation's own; `command.userId` and `command.email` are trusted
  application inputs, not verified against any session or auth system
  (none exists in this codebase, and Section 13 explicitly prohibits
  introducing one). A mismatch returns a bare `ForbiddenError` — no
  sixth error type was added beyond Section 2's explicit five.
- **`inviteMember` gains inviter authorization** (Section 8): a new
  `canInviteAs(inviterRole, targetRole)` helper
  (`invite-authorization.ts`) encodes the matrix — `OWNER` can invite
  `ADMIN`/`MEMBER`, `ADMIN` can invite `MEMBER` only, nobody can invite
  `OWNER`. `inviteMember` now takes a `membershipRepository` dependency,
  looks up the inviter's own membership via the new
  `MembershipRepository.findByUserId`, and requires it to be `ACTIVE` —
  a judgment call, since Section 3 only says "must have OWNER or ADMIN
  membership" without specifying status. This closes the authorization
  gap E05-T06's own documentation flagged as open.
- Added `MembershipRepository.findByUserId`/`existsActive`/`save`
  (E05-T07) — the same "necessary repository interaction, not a full
  adapter" shape `existsBySlug`/`save` were for `OrganizationRepository`
  in E05-T03.
- **Deliberately did not add `InvitationRepository.findPendingById`**
  despite the founder directive suggesting one: `acceptInvitation` needs
  the invitation's actual status to distinguish `InvitationNotFoundError`
  from `InvitationNotPendingError` — a pending-filtered lookup would make
  the two indistinguishable. The existing `findById` (any status,
  E05-T05) is what's used instead.
- Added `INVITATION_ACCEPTED_EVENT`/`InvitationAcceptedPayload` and
  `INVITATION_EXPIRED_EVENT`/`InvitationExpiredPayload` to
  `application/events.ts`. **Fixed `MemberJoinedPayload.role`** from a
  lowercase T01-era placeholder (`"owner" | "admin" | "member"`) to the
  real, uppercase `MembershipRole` values — `acceptInvitation` is the
  first use case to actually publish `MEMBER_JOINED_EVENT`, so this
  changes no shipped behavior, following the exact precedent
  `InvitationCreatedPayload.role` set in E05-T06.
- 2 new test files (1 new — `accept-invitation.test.ts`, 15 tests; 1
  extended — `invite-member.test.ts`, +8 authorization-matrix tests),
  plus 1 backfilled into the existing `index.test.ts` export smoke test
  (tenancy package: 270→294 total; 19→20 files). No repository adapters,
  no SQL, no RLS, no migrations, no HTTP handlers, no email delivery, no
  invitation tokens, no `User`/`Session`/`Auth` module — all explicitly
  out of scope per this task's founder directive.

### In-memory Tenancy workflow integration harness (E05-T08)

- New `test-support/` directory (sibling to `test/`, not part of the
  public `src/` surface — same precedent as `packages/platform/test-support/`):
  `InMemoryOrganizationRepository`, `InMemoryMembershipRepository`,
  `InMemoryInvitationRepository` (copy-on-write `Map` storage — `save()`
  replaces the map rather than mutating it, so arrays returned by prior
  `list*`/`find*` calls stay valid), an `EventCollector` (captures every
  published event in order; `expectSequence`/`expectNone`/`expectCount`/
  `payloadAt`), and a `TenancyWorkflowHarness` class wiring all three
  repositories, a `FixedClock`, one shared `UnitOfWork`/`EventBus` pair,
  and `createOrganization`/`inviteMember`/`acceptInvitation` as thin
  typed wrappers. `tsconfig.json`'s `include` gained `"test-support"`.
  Full detail:
  [docs/modules/tenancy-workflow-integration.md](../../docs/modules/tenancy-workflow-integration.md).
- 13 new end-to-end tests (`test/workflow/tenancy-workflow.test.ts`):
  happy path (create → invite → accept, exact event sequence asserted),
  duplicate slug, duplicate pending invitation, expired invitation,
  revoked invitation, the full inviter-authorization matrix (unauthorized
  inviter, admin→member, admin cannot invite admin, owner→admin),
  exactly-once invitation consumption/membership creation, and three
  transaction-semantics tests (Section 7).
- **Deliberately did not add `OrganizationRepository.findBySlug` or
  `MembershipRepository.findByOrganizationAndUser`** despite the founder
  directive's Section 3 suggesting both: no scenario resolves an
  organization by slug (`createOrganization` returns the id directly),
  and the existing `findByUserId(context: OrgScopedContext, userId)`
  already *is* "find by organization and user" since `context`
  carries the organization half — a second method would duplicate it.
- **Proved, not just documented, a real transaction-semantics
  limitation**: a dedicated test wraps the real
  `InMemoryInvitationRepository` in a `save`-throwing decorator and calls
  `acceptInvitation` directly, confirming the in-memory `UnitOfWork`
  provides event-staging atomicity (nothing publishes until `work(tx)`
  returns) but **no storage rollback** — a mid-flow throw after
  `membershipRepository.save` leaves that write persisted. Closing this
  gap is `PostgresUnitOfWork` (E03-T40)'s job via a real SQL transaction,
  out of this task's scope.
- 1 new test file (tenancy package: 294→307 total tests; 20→21 files). No
  Postgres adapters, no SQL, no RLS, no migrations, no Drizzle schemas,
  no HTTP handlers, no new repository port methods, no performance
  tuning, no dependency-injection framework — all explicitly out of
  scope per this task's founder directive.

### Postgres schema design (E05-T09)

- New `src/infrastructure/postgres/schema/` (internal — no `./postgres`
  export condition in `package.json` yet, since no repository adapter
  exists to export): Drizzle table definitions for `tenancy.organizations`/
  `tenancy.memberships`/`tenancy.invitations`, freezing the database shape
  before any adapter is built. `drizzle-orm` added as a peer + dev
  dependency, following the exact `postgres`-driver precedent already
  established in `@corestack/platform`'s `package.json` — optional peer,
  so the main `.` entry point never pulls it in. Full detail:
  [docs/modules/tenancy-schema-design.md](../../docs/modules/tenancy-schema-design.md)
  and
  [docs/modules/tenancy-persistence-mapping.md](../../docs/modules/tenancy-persistence-mapping.md).
- **[ADR-0023](../../docs/adr/0023-tenancy-schema-text-enum-with-check-constraint.md):**
  enum-shaped columns (`status`/`role`) are CHECK-constrained `text`, not
  native Postgres `ENUM` types — reconciling the founder directive's
  "create database enums" wording with `DATABASE.md` §1 rule 5's existing
  "text + CHECK constraint, not native Postgres enums" decision. Each
  column's value set is sourced directly from the same domain enum
  constant object the aggregate already exports, so a renamed domain
  value breaks the schema file at compile time.
- **Two partial unique indexes** encode the state-dependent uniqueness
  rules Section 5/6 asked for: `memberships_active_org_user_key` (at most
  one `ACTIVE` membership per `(organization_id, user_id)`) and
  `invitations_pending_org_email_key` (at most one `PENDING` invitation
  per `(organization_id, email)`). Verified empirically (not just
  asserted) that both partial-index `WHERE` predicates and all three
  `CHECK` constraints render as literal SQL text with no bind-parameter
  placeholder — a schema test recursively confirms no `Param` node
  appears in any of these expression trees.
- **`organizations` uses a plain, non-partial `UNIQUE(slug)`** — unlike
  `tenancy-contract.md`'s 4-state blueprint (`PUX slug WHERE status <>
  'purged'`), the implemented 3-state `Organization` model has no
  `purged` state to key a partial index off of; a `DELETED`
  organization's slug stays taken today. Flagged as a schema migration
  this document anticipates, not resolves, should the 4-state
  reconciliation land later.
- **No `version`/optimistic-concurrency column on any of the three
  tables** — none of the three aggregates carries one today. Documented
  as an open concurrency-expectations gap (not silently added or
  silently ignored) in the schema-design doc.
- **No DB-side `.defaultNow()` on any creation timestamp**
  (`created_at`/`joined_at`) — unlike `DATABASE.md`'s general "default
  `now()`" guidance, every aggregate always supplies its own creation
  instant, and a DB-computed fallback could silently desynchronize a row
  from the same instant already published on its creation event; omitting
  the default keeps every insert obligated to supply the real value, the
  same discipline already applied to ids (no `.defaultRandom()`).
- **Repository persistence expectations documented, not new methods
  added**: reviewed all three existing repository ports against this
  schema and added a one-line cross-reference in each port's own doc
  comment to `tenancy-schema-design.md`'s "Repository persistence
  expectations" section (transactional boundaries, uniqueness
  expectations — the three `exists*` best-effort checks each get a real
  constraint backstop once a live adapter exists — concurrency
  expectations, eventual consistency expectations).
- **RLS attachment points documented, not implemented**: `memberships`/
  `invitations` attach the platform's existing `buildTenantIsolationDdl`
  (E03-T30) with no open question; `organizations` is flagged as the one
  case needing a real design decision (key the policy off `id` directly,
  or a membership-join condition) — deferred explicitly to a future RLS
  task, not decided here.
- 23 new schema tests (`test/infrastructure/schema.test.ts`, no live
  database — `getTableConfig` introspection only): schema builds, column
  not-null/primary-key shape, enum values match the domain enums exactly,
  unique/partial-unique indexes and foreign keys exist, no `token_hash`
  column on `invitations` (tenancy package: 307→330 total tests; 21→22
  files). No repository adapters, no SQL queries, no RLS policies, no
  migrations beyond these schema definitions, no HTTP handlers — all
  explicitly out of scope per this task's founder directive. No new
  public exports — the schema module is internal to the package.

### Row-Level Security policy design + migration (E05-T10)

- New `src/infrastructure/postgres/rls/` (internal — no `./postgres`
  export condition): `buildOrgScopedTableRlsDdl` (for `memberships`/
  `invitations`) and `buildOrganizationsRlsDdl` (for `organizations`) —
  pure SQL-text generators, no DB dependency, mirroring
  `@corestack/platform`'s `buildTenantIsolationDdl` (E03-T30) but
  deliberately not reusing it verbatim: per-command policies
  (`SELECT`/`INSERT`/`UPDATE`) so `DELETE` can be denied outright, rather
  than one blanket `FOR ALL` policy per role. `TENANCY_APP_ROLE`
  (`tenancy_app`) / `TENANCY_PLATFORM_ROLE` (`tenancy_platform`) role
  names, and `ensureTenancyModuleRoles` — idempotent role bootstrap
  (delegates to `@corestack/platform`'s `ensureTenancyRoles`) plus the
  `GRANT USAGE ON SCHEMA platform`/`GRANT INSERT ON platform.outbox`
  grants `PostgresUnitOfWork`'s event staging needs. Full detail:
  [docs/modules/tenancy-rls-design.md](../../docs/modules/tenancy-rls-design.md).
- **[ADR-0024](../../docs/adr/0024-tenancy-organizations-rls-direct-visibility.md):**
  resolves the `organizations` visibility question E05-T09 left open.
  Direct (id-keyed) visibility — `id =
  current_setting('app.current_org')::uuid` — not membership-driven or
  hybrid, both of which would require a currently-nonexistent
  user-identity session variable. The identical predicate is used for
  `INSERT` as for `SELECT`/`UPDATE`: no special-cased "no org yet"
  creation bypass, since `Organization.id` is application-generated
  before persistence and the future adapter is expected to set
  `app.current_org` from the aggregate's own id for every `save` call.
- **`app.current_org`, not the founder directive's literal
  `app.current_organization_id`.** Every policy uses the platform's
  existing, sole, already-certified session variable — introducing a
  second, differently-named one would itself violate the same
  directive's "do not introduce a new mechanism" instruction. Flagged
  explicitly for founder confirmation, not silently decided — see the
  design doc's "A note on the session variable's name."
- **DELETE is never granted or policied for `tenancy_app`**, on any of
  the three tables — defense in depth alongside `FORCE ROW LEVEL
  SECURITY`, since no aggregate method ever performs a physical
  `DELETE` (every terminal transition is a soft-delete `status` UPDATE).
  `tenancy_platform` is granted `SELECT` only on all three tables,
  matching `examples/acme-crm-module`'s own precedent.
- New migration `migrations/tenancy/0002_create-tenancy-tables.sql`:
  `CREATE TABLE` statements generated via `drizzle-kit generate` against
  the frozen E05-T09 schema and hand-verified column-for-column; RLS/
  GRANT statements hand-authored but checked byte-for-byte
  (whitespace-normalized) against the TypeScript generators via
  `test/infrastructure/migration-rls-consistency.test.ts`. Every table
  gets both `ENABLE` and `FORCE ROW LEVEL SECURITY` in this same
  migration — never a moment any of the three tables exists without RLS
  already attached.
- **Fixed a real bug found during review**: every `CHECK` constraint and
  `CREATE POLICY` predicate initially referenced its column
  schema/table-qualified (e.g. `tenancy.organizations.status`) — not
  valid Postgres syntax in either position (a three-part dotted name
  parses as `database.schema.object`, not `schema.table.column`).
  Fixed in the generators, the migration, and the E05-T09 `sqlInList`
  schema helper (which had the identical latent issue — Drizzle's own
  serializer renders an interpolated column reference fully qualified
  in this position) to use bare column names throughout, plus a
  regression test asserting no `tenancy.\w+.\w+`-shaped reference
  appears in any generated statement.
- 47 new tests: 40 in `test/infrastructure/rls-policies.test.ts` (DDL-
  level, no live database) and 7 in
  `test/infrastructure/migration-rls-consistency.test.ts` (parses the
  real migration file via `@corestack/platform`'s `parseMigrationFile`
  and cross-checks its text against the generators) — tenancy package:
  330→377 total tests; 22→24 files. No repository adapters, no SQL query
  methods, no HTTP handlers, no anonymous invitation acceptance, no new
  cross-organization admin bypasses beyond the existing
  `platform_full_access` pattern — all explicitly out of scope per this
  task's founder directive.

### Real Postgres repository adapters (E05-T11)

- New `src/infrastructure/postgres/postgres-{organization,membership,
  invitation}-repository.ts`, exported from a new `./postgres` package
  subpath alongside the E05-T10 RLS generators/role bootstrap:
  `PostgresOrganizationRepository`/`PostgresMembershipRepository`/
  `PostgresInvitationRepository` replace the in-memory reference
  repositories for real persistence.
- **Every repository port method now takes `tx: TransactionContext` as
  its first parameter** — the generic kernel type, not a Postgres-
  specific one, so `OrganizationRepository`/`MembershipRepository`/
  `InvitationRepository` stay infrastructure-agnostic. This was a
  necessary breaking change to all three ports, `createOrganization`/
  `inviteMember`/`acceptInvitation` (threading `tx` from their own
  `uow.run()` callback), the in-memory repositories, and every test
  double that used a full-arity signature — required because every real
  repository call happens inside a `UnitOfWork.run()` callback, and
  `docs/unit-of-work.md`'s own rule forbids opening a second transaction
  there. `PostgresOrganizationRepository`/etc. narrow `tx` to
  `PostgresTransactionContext` internally to reach `.sql`.
- **New `{Organization,Membership,Invitation}.reconstitute(...)` domain
  factories** — loads full persisted state with no domain-event
  emission and no creation-time revalidation, the counterpart to each
  aggregate's existing `create`. Backs three new dedicated mapper
  modules (`infrastructure/postgres/mappers/`), row ↔ aggregate, with
  no inline mapping in any repository method.
- **Constraint-violation translation** (`infrastructure/postgres/
  constraint-violation.ts`): `error.code === '23505'` +
  `error.constraint_name` (both confirmed empirically against real
  PostgreSQL 18.4 before writing any code) map to `DuplicateSlugError`/
  `MembershipAlreadyExistsError`/`InvitationAlreadyExistsError` — the
  real enforcement behind each repository's best-effort `exists*`
  pre-check. All three use cases now catch their own `save()` call and
  convert this same already-declared error type into `Result.err(...)`,
  making the translation load-bearing rather than cosmetic.
- **[ADR-0025](../../docs/adr/0025-organization-save-sets-own-org-context.md):**
  corrects a specific claim in ADR-0024 — `PostgresOrganizationRepository
  .save` sets its own `app.current_org` from the aggregate's own id as
  its first statement, since `PostgresUnitOfWork`'s constructor cannot
  know an about-to-be-created organization's id at construction time.
  `existsBySlug`/`findBySlug` (both pre-org-scope) elevate to the
  `tenancy_platform` role for their one query each — ADR-0024's own
  visibility model structurally cannot see other organizations'
  slugs otherwise. `ensureTenancyModuleRoles` gained one grant,
  `GRANT tenancy_platform TO tenancy_app WITH INHERIT FALSE` —
  confirmed empirically that `WITH INHERIT FALSE` is load-bearing: a
  plain inheriting grant would silently and permanently disable tenant
  isolation for the app role, not merely enable a deliberate elevation.
- **No `findByOrganizationAndUser`** (Section 5, despite the founder
  directive's wording) — `findByUserId(tx, context, userId)` already is
  this operation. **`findBySlug` added** (Section 4's explicit ask,
  no current caller — flagged, not mistaken for a discovered
  requirement).
- New dual-mode Postgres integration-test harness
  (`test/integration/tenancy-postgres.postgres.test.ts`,
  `pnpm test:integration`) — local `DATABASE_URL` scratch database or a
  Testcontainers fallback, mirroring `@corestack/platform`'s own
  private `test-support/test-database.ts` strategy (not reusable
  across the package boundary, so reimplemented locally). Every
  repository call runs through a genuinely authenticated `tenancy_app`
  connection, never the superuser session — proving RLS is actually
  enforced. **Fixed a real, previously-undiscovered defect**: this
  package's `vitest.config.ts` (E05-T01) excluded `test/integration/**`
  globally, including when explicitly targeted via the CLI (Vitest's
  `--exclude` adds to a config file's exclude list rather than
  replacing it) — `test:integration` could never have worked before
  this task, since tenancy had no integration test to expose the bug
  until now. Fixed with a dedicated `vitest.integration.config.ts` and
  an updated `test:integration` script using `--config`.
- `TenancyWorkflowHarness` (test-support, E05-T08) gained two optional
  constructor options — `repositories` (substitute the in-memory
  repositories) and `uowFactory` (build a fresh, correctly-org-scoped
  `UnitOfWork` per call) — enabling Section 10's "reuse the existing
  workflow harness with a Postgres-backed repository set" without
  duplicating any of T08's own 13 in-memory scenarios. Every existing
  unit test is unaffected (both options default to the prior in-memory
  behavior).
- 17 new tests total (tenancy package: 377→378 unit tests, 24 files
  unchanged — one test added to the existing export-surface snapshot
  suite for the new `./postgres` subpath; plus a new 16-test integration
  file, run separately via `pnpm test:integration` against real
  PostgreSQL 18): 14 direct repository tests (round-trips, slug/active-
  membership/pending-invitation uniqueness via real constraint
  violations, RLS isolation both directions, soft-delete, timestamp/enum
  round-trips) and 2 workflow-level tests reusing
  `TenancyWorkflowHarness`. No repository
  query services beyond the existing ports, no HTTP handlers, no
  background jobs, no anonymous invitation acceptance, no cross-
  organization admin features — all explicitly out of scope per this
  task's founder directive.

### Query services (E05-T12)

- Three new query services — `getOrganization`, `listOrganizationMembers`,
  `listPendingInvitations` (`src/application/get-organization-query.ts`,
  `list-organization-members-query.ts`, `list-pending-invitations-query.ts`)
  — the module's complete read side. Each returns a plain DTO
  (`OrganizationSummary`/`OrganizationMemberSummary`/
  `PendingInvitationSummary`), never an `Organization`/`Membership`/
  `Invitation` aggregate, via an explicit, hand-written aggregate-to-DTO
  mapper (`toOrganizationSummary`/`toOrganizationMemberSummary`/
  `toPendingInvitationSummary`) bundled in the same file.
- **No new repository method was added.** Every query is built entirely
  on `findById`/`listForOrganization`, unchanged since E05-T02/T04/T11 —
  Section 2's explicit ask. Each query still runs inside a
  `deps.uow.run()` call purely to obtain the `TransactionContext` a
  repository method requires (`docs/unit-of-work.md`'s transaction-
  ownership rule leaves no other way to reach one); nothing is ever
  staged on `tx.publish`, so no query has a side effect despite the
  transaction it opens and commits.
- **`getOrganization` deliberately mirrors `OrganizationRepository
  .findById`'s exact shape** — `context: OrgScopedContext` plus a
  separate target `organizationId`, not just `context.organizationId` —
  so a caller-supplied target that names a different organization than
  the one the transaction is scoped to returns `null` via RLS, exactly
  like a genuinely missing row. This is the query-layer reuse of the
  identical RLS mechanism T11's repository-layer tests already proved.
- **DTO field lists match the founder directive exactly**, including two
  deliberate omissions: `OrganizationSummary` excludes `deletedAt`
  (`Organization` itself has the getter; the directive's field list
  stops at `updatedAt`), and `OrganizationMemberSummary` excludes
  `removedAt` (Section 5) — `status` alone already communicates
  `REMOVED` in both cases. `listOrganizationMembers` does **not** filter
  out `REMOVED` memberships (only the field is hidden, not the row);
  `listPendingInvitations` filters to `PENDING` only (Section 6) and has
  no `status` field at all, since every returned row is `PENDING` by
  construction.
- Both list queries sort in the application layer after mapping to DTOs
  (`listOrganizationMembers` by `joinedAt` ascending, `listPendingInvitations`
  by `createdAt` ascending) — not via `ORDER BY` in the shared repository
  method, to avoid what would amount to a new repository capability.
- `TenancyWorkflowHarness` (test-support) gained matching
  `getOrganization`/`listOrganizationMembers`/`listPendingInvitations`
  wrapper methods, reusing the harness's existing repository/`UnitOfWork`
  wiring — no separate query-only harness.
- New integration tests (Section 8): organization A cannot see
  organization B through any of the three queries, and `existsBySlug`'s
  platform-role elevation does not leak into `getOrganization`'s
  visibility within the same transaction (the elevation-then-query
  sequence runs in one transaction on purpose, to prove `RESET ROLE`
  actually took effect rather than merely that a fresh transaction would
  have started unprivileged). The existing golden-path workflow
  integration test (E05-T08/T11) now also calls all three queries after
  its accept step, reusing the seeded scenario rather than seeding a
  separate query-only one (Section 9).
- 17 new tests total: 13 unit tests (DTO mapping, sort order, `PENDING`-
  only filtering, cross-organization isolation against in-memory test
  doubles — tenancy package: 378→391 unit tests, 24→27 files) and 4 new
  Postgres integration tests (tenancy package: 16→20 integration tests).
  No new repository methods, no HTTP handlers, no background jobs, no
  anonymous invitation acceptance, no cross-organization admin features,
  no pagination, no filtering, no search — all explicitly out of scope
  per this task's founder directive. Full detail:
  [docs/modules/tenancy-query-services.md](../../docs/modules/tenancy-query-services.md).

### HTTP interface (E05-T13)

- A thin HTTP adaptation layer over the existing application use cases
  and query services — six routes (`POST /organizations`, `POST
  /organizations/:id/invitations`, `POST /invitations/:id/accept`, `GET
  /organizations/:id`, `GET /organizations/:id/members`, `GET
  /organizations/:id/invitations`), new `src/interface/http/` (filling in
  the E05-T01 reserved `src/interface/` barrel), exported from a new
  `./interface` package subpath. **No new repository method, use case, or
  query was added** — every route calls an existing service unchanged.
- **No HTTP framework anywhere in this monorepo** (confirmed by search
  before writing any code) — every route handler is a plain `async`
  function, `(request, deps) => Promise<response>`, with one
  `try`/`catch`; `tenancyRoutes` is declarative `{method, path, handler}`
  metadata a future Hono binding (per `ARCHITECTURE.md` §10) would
  register, not a router this package implements or matches against
  itself (Section 14: "do not introduce a controller framework... do not
  introduce middleware abstractions... do not introduce a dependency
  injection container").
- **`context.organizationId` always comes from an `X-Organization-Id`
  header, never the URL path** — even on the four routes whose path also
  names an organization (`docs/security/how-to-build-a-tenant-safe-feature.md`
  step 1). A path segment naming an organization is a *claim*, checked
  against the header either by the use case itself (`inviteMember`'s own
  existing `ForbiddenError` on mismatch) or by RLS (`getOrganization`'s
  mirrored target/context shape from E05-T12) — never used to construct
  scope. `X-Actor-Id`/`X-Organization-Id` are a deliberate, documented
  stand-in for a real authentication provider (explicitly out of scope
  per Section 1), validated as UUID-shaped on every route.
- **404, never 403, for cross-tenant reads (Section 8)**: `GET
  /organizations/:id` relies entirely on RLS via `getOrganization`'s
  existing target-vs-context shape. `GET /organizations/:id/members`/
  `.../invitations` call `getOrganization` as an explicit pre-check
  before their own list query — neither `listOrganizationMembers` nor
  `listPendingInvitations` has an independent target parameter (E05-T12
  deliberately did not add one), so without this pre-check the path `:id`
  would be silently ignored, returning the wrong organization's data
  rather than a 404.
- **One error-mapping function**, `mapErrorToHttpResponse`
  (`errors.ts`): `ValidationError`→400, `NotFoundError`→404,
  `ConflictError`→409, `ForbiddenError`→403, `UnauthorizedError`→401,
  anything else→500 with a fixed, generic body that never reads
  `error.message`/`.stack`. Every tenancy-specific error class already
  extends one of the first five kernel classes, so this table needs no
  per-tenancy-error-class entry. One documented consequence: the invite
  route's `role` field is restricted to `z.enum(["ADMIN", "MEMBER"])` at
  the interface layer, which makes `CannotInviteOwnerError` unreachable
  via HTTP (it remains reachable, and tested, for direct non-HTTP callers
  of `inviteMember`).
- **Deliberate, documented divergences from the future full API
  standard** (`docs/architecture/API.md` §19–22): 400 not 422; `{code,
  message, metadata}` not RFC 9457 `problem+json`; bare arrays not
  `{data, pagination}`; no `/v1` prefix — each traced to a specific
  Section of this task's founder directive, not an oversight.
- **The sharpest trust-boundary limitation**: `POST
  /invitations/:id/accept` has no organization id in its path at all
  (`acceptInvitation`'s own command has no `organizationId` field);
  `context.organizationId` comes from `X-Organization-Id`, `userId` from
  `X-Actor-Id`, but `email` comes from the request body — the claim
  `acceptInvitation` checks against `invitation.email`. Without a real
  authentication provider, nothing verifies the body-supplied email
  belongs to the caller; the security of this route rests entirely on
  that equality check, a pre-existing gap `accept-invitation-usecase.md`
  already documented and this route inherits, not one it closes.
- 73 new tests total: 59 unit tests (tenancy package: 391→450 unit tests,
  27→37 files — `validation.ts`/`context.ts`/`errors.ts` helpers plus one
  test file per route handler against in-memory test doubles; genuine
  cross-tenant invisibility is not representable in-memory, since
  `InMemoryOrganizationRepository.findById` ignores context — every such
  test is annotated, not silently omitted) and 14 new Postgres
  integration tests (tenancy package: 20→34 integration tests) covering
  successful create/invite/accept, successful reads, a validation
  failure, duplicate conflicts, an authorization failure, and — the
  property that actually requires a real database — RLS-backed
  cross-tenant invisibility for all three `GET` routes. No authentication
  providers, no background jobs, no anonymous invitation acceptance, no
  pagination, no filtering, no search — all explicitly out of scope per
  this task's founder directive. A fifth validation helper,
  `requireNonEmptyString`, was written and exported but never called by
  any route (every body field goes through `parseBody`/`parseUuid`/
  `parseEmail` instead) — removed before commit rather than shipped as
  unused public surface. Full detail:
  [docs/modules/tenancy-http-interface.md](../../docs/modules/tenancy-http-interface.md).

### Invitation-notification orchestration (E05-T14)

- The durable background-processing side of invitation notifications —
  `INVITATION_CREATED`/`INVITATION_ACCEPTED`/`INVITATION_EXPIRED` domain
  events now produce `tenancy.notification_work_items` rows (`PENDING`
  status). `MEMBER_JOINED` is explicitly ignored. **No email is sent**:
  no SendGrid/SES/Postmark/SMTP client, no cron job, no background worker
  anywhere in this package (Section 13).
- `NotificationWorkItem` (Section 4 field list exactly) and
  `buildNotificationWorkItemFromEvent` (`src/application/`) — a pure,
  total mapping function, zero I/O, returning `null` for `MEMBER_JOINED`,
  any unrecognized event name, or any event with `organizationId: null`.
  `recipient` is nullable, not `?? ""`-coerced — `INVITATION_ACCEPTED`/
  `INVITATION_EXPIRED` payloads carry no email field at all, and Section
  5 forbids the repository read that resolving one would require.
- `NotificationWorkItemRepository` (port, `create` only — no
  `findById`/list method, since Section 8's integration tests verify a
  created row directly against the table) and
  `PostgresNotificationWorkItemRepository` (adapter,
  `src/infrastructure/postgres/`, exported from `@corestack/tenancy/postgres`).
  This is `@corestack/tenancy`'s first real `GlobalRepository`
  ([ADR-0026](../../docs/adr/0026-notification-work-item-repository-is-global.md)):
  its only caller is a replayed domain event, not an authenticated
  request, so there's no `OrgScopedContext`/`app.current_org` to thread —
  visibility comes from the `tenancy_platform` role's RLS bypass instead.
- `createInvitationNotificationSubscription`
  (`invitation-notification-consumer.ts`) — **a single wildcard
  (`event: "*"`) `EventSubscription`, not three.** `EventSubscription.consumer`
  doubles as the outbox relay's per-consumer checkpoint key; three
  subscriptions sharing one consumer name across three event names would
  each independently advance the *same* checkpoint row, a hazard
  `create-core-stack.ts`'s duplicate-registration check does not catch
  (it only flags an identical `(consumer, event)` pair). One subscription,
  filtering internally against a `HANDLED_EVENT_NAMES` set, has exactly
  one checkpoint.
- **Atomicity via a hand-rolled transaction, not the kernel's generic
  `idempotentHandler`.** The handler opens its own `PostgresUnitOfWork`
  transaction and sequences `hasProcessed` → build (pure) → insert →
  `markProcessed` by hand — the atomicity Section 8's "transaction
  rollback safety" test requires, which the kernel's three-separate-step
  wrapper can't provide.
- **A real bug this task's own tests caught**: the first version elevated
  to `tenancy_platform` only around the repository's own `INSERT`
  (mirroring `existsBySlug`/`findBySlug` too literally), leaving
  `hasProcessed`/`markProcessed` running as the unprivileged `tenancy_app`
  role against `platform.processed_events`. The real-Postgres integration
  suite failed immediately with `permission denied for table
  processed_events`. Fixed by moving `SET LOCAL ROLE tenancy_platform` to
  the first statement in the transaction, before the `hasProcessed`
  check, and removing all elevation logic from the repository's own
  `create` method. The rollback-safety test now asserts a specific
  expected Postgres error (`/invalid input syntax/i`), not a bare
  `.toThrow()` — a bare assertion would have passed even during the buggy
  version, since a permission-denied error is still a thrown error.
- New migration `migrations/tenancy/0003_create-notification-work-items.sql`
  (all Section 4 fields, both CHECK constraints, standard org-scoped RLS
  for `tenancy_app` kept for forward-compatibility though unused by any
  current caller, `tenancy_platform` gets `SELECT`+`INSERT` unlike every
  other tenancy table's `SELECT`-only grant). `attempts` has no column
  `DEFAULT` — the only writer always supplies it explicitly, so a default
  would never fire. Two new `ensureTenancyModuleRoles` grants
  (`tenancy_platform` gains `USAGE` on the `platform` schema and
  `SELECT, INSERT` on `platform.processed_events`).
- `createInvitationNotificationSubscription` is exported from
  `@corestack/tenancy/postgres` but **not** registered into
  `createTenancyModule`'s `eventHandlers` by this task — the same
  deferred-wiring cut E05-T13 made for `tenancyRoutes`.
  `module.test.ts`'s existing `eventHandlers` `toHaveLength(1)` assertion
  (the pre-existing purge subscription) is the concrete proof this is
  deliberate.
- 16 new unit tests (tenancy package: 450→466 unit tests, 37→40 files):
  7 pure event→work-item mapping tests, 2 subscription-shape/ignored-event
  tests, 7 migration/RLS-consistency tests (the shipped migration matches
  `buildOrgScopedTableRlsDdl`'s real generator output byte-for-byte). 7
  new real-Postgres integration tests (tenancy package: 34→41 integration
  tests): created→`PENDING` work item with recipient, duplicate delivery
  → no duplicate row, accepted/expired → null-recipient work items,
  replay safety, transaction rollback safety, `MEMBER_JOINED` ignored
  end-to-end. Full detail:
  [docs/modules/tenancy-notification-orchestration.md](../../docs/modules/tenancy-notification-orchestration.md).
