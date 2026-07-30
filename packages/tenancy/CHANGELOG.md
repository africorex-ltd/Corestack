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
