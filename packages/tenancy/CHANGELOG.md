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
