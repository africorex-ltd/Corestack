# E05-T07 — `acceptInvitation` Use Case + `inviteMember` Authorization: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T07 only. Do not implement SQL
  persistence, RLS policies, migrations, HTTP handlers, email delivery,
  or invitation tokens." Sections 1–15.
- **Verdict:** **Complete**, application layer only, exactly as scoped.

## What shipped

In `packages/tenancy/src/application/`:

| File | Contents |
| --- | --- |
| `accept-invitation.ts` | `AcceptInvitationCommand`/`Result`/`Deps`, `acceptInvitation` use case |
| `invitation-not-found-error.ts` | `InvitationNotFoundError` (extends `NotFoundError`) |
| `invitation-expired-error.ts` | `InvitationExpiredError` (extends `ConflictError`) |
| `invitation-not-pending-error.ts` | `InvitationNotPendingError` (extends `ConflictError`) |
| `membership-already-exists-error.ts` | `MembershipAlreadyExistsError` (extends `ConflictError`) |
| `inviter-not-authorized-error.ts` | `InviterNotAuthorizedError` (extends `ForbiddenError`) |
| `invite-authorization.ts` | `canInviteAs` helper |
| `membership-repository.ts` (modified) | added `findByUserId`, `existsActive`, `save` |
| `invite-member.ts` (modified) | inviter-authorization check added (Section 8) |
| `events.ts` (modified) | added `INVITATION_ACCEPTED_EVENT`/`INVITATION_EXPIRED_EVENT`, fixed `MemberJoinedPayload.role` casing |

`InvitationRepository`, `Invitation`, `Membership`, and `UnitOfWork` are
reused directly, not reimplemented (Section 2).

Full design writeup:
[docs/modules/accept-invitation-usecase.md](../modules/accept-invitation-usecase.md)
(command flow, sequence diagram, authorization matrix, expiry
enforcement, membership creation, event flow, trust assumptions,
non-goals).

**Tests:** 2 test files touched (1 new, 1 extended), 24 new tests
(tenancy package: 270→294 total) — `accept-invitation.test.ts` (15
tests: success at both `ADMIN`/`MEMBER` roles, invitation not found,
email mismatch, not-pending for accepted/revoked, expiry enforcement
with persistence and event assertions, duplicate active membership,
event publication, `UnitOfWork` usage, invalid ids, empty `requestId`);
`invite-member.test.ts` extended with an 8-test exhaustive authorization
matrix (`OWNER`→`MEMBER`/`ADMIN`, `ADMIN`→`MEMBER`, `ADMIN`↛`ADMIN`,
`MEMBER`↛anyone, no membership at all, `SUSPENDED` `OWNER`, no
events/persistence on rejection). The remaining 1 test was added to the
existing `index.test.ts` export smoke test.

## Expiry enforcement moved to acceptance time

Section 7: "This use case is responsible for enforcing time." E05-T05's
`Invitation.expire()` deliberately never compares `now` against
`expiresAt` — this use case is the first caller that does. Discovering
an expiry is **not a no-op rejection**: `invitation.expire(now)` is
called, persisted via `invitationRepository.save`, and its event
published through the same `UnitOfWork` *before*
`InvitationExpiredError` is returned. This closes the gap E05-T05's own
domain doc flagged explicitly: "a future `AcceptInvitation` use case is
responsible for the `now > expiresAt` check itself." That use case now
exists.

## Identity check, not authentication

Section 3/13: "treat identity as an input... do not introduce
authentication infrastructure." `command.userId` and `command.email` are
trusted application inputs. This use case checks only that
`command.email` equals `invitation.email` — internal consistency between
two claims, not proof that the caller genuinely is who they claim.
**No sixth error type was added** for this check: Section 2 lists five
new error types, none named for acceptor identity, so a bare kernel
`ForbiddenError` is returned instead of inventing a sixth beyond that
explicit list — a deliberate scope decision, documented in the design
doc's "Trust assumptions" section.

## `inviteMember` gains inviter authorization (Section 8)

A new `canInviteAs(inviterRole, targetRole)` helper
(`invite-authorization.ts`) encodes the matrix: `OWNER` can invite
`ADMIN`/`MEMBER`; `ADMIN` can invite `MEMBER` only; nobody can invite
`OWNER` (checked unconditionally, before the inviter-role switch).
`inviteMember` now takes a `membershipRepository` dependency, looks up
the inviter's own membership via the new
`MembershipRepository.findByUserId`, and additionally requires it to be
`ACTIVE` — Section 3 only says "must have OWNER or ADMIN membership,"
without specifying status; requiring `ACTIVE` is a judgment call
(a `SUSPENDED` owner shouldn't retain active privileges), documented as
such rather than left implicit. This closes the authorization gap
E05-T06's own documentation flagged as open: previously, any caller
holding a valid `OrgScopedContext` for an organization could invite into
it regardless of their own membership or role.

## Repository port additions — and one deliberate non-addition

Added to `MembershipRepository`: `findByUserId`, `existsActive`, `save`
— the same "necessary interaction, not a full adapter" shape
`existsBySlug`/`save` were for `OrganizationRepository` in E05-T03.

**Deliberately did not add `InvitationRepository.findPendingById`**,
despite the founder directive suggesting one. `acceptInvitation` needs
to distinguish `InvitationNotFoundError` (no such invitation) from
`InvitationNotPendingError` (exists, but `ACCEPTED`/`REVOKED`/already
`EXPIRED`) — two error types Section 2 requires as separate exports. A
method that pre-filters to `PENDING` only would return `null` for both
cases, making them indistinguishable from inside the use case. The
existing `findById` (E05-T05, any status) already provides exactly what
was needed, so nothing new was added to this port.

## Event contract additions, including a casing fix

Added `INVITATION_ACCEPTED_EVENT`/`InvitationAcceptedPayload` and
`INVITATION_EXPIRED_EVENT`/`InvitationExpiredPayload`. **Fixed
`MemberJoinedPayload.role`** from a lowercase T01-era placeholder
(`"owner" | "admin" | "member"`) to the real, uppercase `MembershipRole`
values (`"OWNER" | "ADMIN" | "MEMBER"`) — `acceptInvitation` is the first
use case to ever call `membershipRepository.save`/publish
`MEMBER_JOINED_EVENT`, so this changes no shipped behavior. Follows the
exact precedent `InvitationCreatedPayload.role` set in E05-T06 when it
became the first real consumer of its own event: author the payload
against the real aggregate rather than perpetuate a stale placeholder.

## No client-claimed `organizationId` on `AcceptInvitationCommand`

Unlike `inviteMember` (E05-T06 Section 3 explicitly required
`organizationId` on the command, checked against `context` for
`ForbiddenError`), `AcceptInvitationCommand` carries no such field —
this task's directive lists no equivalent, and `context: OrgScopedContext`
already scopes every repository call this use case makes. An org-scoped
repository returning a row *is* the tenant-isolation guarantee (the same
structural property the RLS harness, E03-T30, certifies); there is no
second, client-supplied `organizationId` here for a mismatch to even be
possible against.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` — all pass.
- `eslint .` — zero findings (two fixes needed along the way: an
  unused-`Membership`-type-only import in `accept-invitation.test.ts`
  and a leftover unused `MembershipStatus` import in
  `invite-member.test.ts` after refactoring — both caught and fixed
  before this report).
- `pnpm -r test` — 659 tests across 62 files in the unit/application
  lanes (tenancy alone: 294, up from 270), plus platform's unchanged 97
  integration tests and acme-crm's unchanged 4.
- Architecture-fitness suite — unchanged at 36 tests across 5 files: no
  new package/manifest surface; none of the new files match
  `/repository/i`.
- Export-surface snapshot — updated and checked in. New exports:
  `acceptInvitation`, `AcceptInvitationCommand`, `AcceptInvitationResult`,
  `AcceptInvitationDeps`, `InvitationNotFoundError`,
  `InvitationExpiredError`, `InvitationNotPendingError`,
  `MembershipAlreadyExistsError`, `InviterNotAuthorizedError`,
  `canInviteAs`, `INVITATION_ACCEPTED_EVENT`, `INVITATION_EXPIRED_EVENT`,
  `InvitationAcceptedPayload`, `InvitationExpiredPayload`.

## Permanent policy (Section 12, adopted)

Authorization is application logic, not a domain rule; expiry is
enforced at orchestration time, not read from the aggregate; acceptance
is atomic with membership creation inside one `UnitOfWork`; duplicate
membership is checked before mutation; all resulting events publish
through `UnitOfWork`.

## What's still open, not resolved here

- **Re-authorizing an invitation at acceptance time.** Authorization is
  a creation-time concern only; an invitation issued under an earlier
  policy is honored as-issued. See the design doc's "Membership
  creation" section.
- **A hard duplicate-membership guarantee.** `existsActive` is
  best-effort, same shape as `existsBySlug`/`existsPendingForEmail` —
  E05-T21's job.
- **Wiring into `createTenancyModule`'s `useCases`** — `TenancyUseCases`
  remains `Record<string, never>`.
- **The 3-state vs. 4-state organization-model reconciliation** — this
  use case never reads `Organization` at all; untouched.
- **Repository adapters, SQL, RLS, migrations, HTTP handlers, email
  delivery, invitation tokens, `User`/`Session`/`Auth` modules** — all
  explicitly out of scope per Section 13.
- **Release-pipeline debt** (recurring, tracked across T01–T07 reports):
  `@corestack/tenancy` remains `0.0.1`, no changeset, eighth task in a
  row adding public surface. Not a blocker — `RELEASE_ENABLED` stays off.

## Next

**E05-T08**: not yet specified by the founder directive sequence. Not
started. Per Section 15, work stops here pending the next prompt — no
SQL persistence, repository adapters, migrations, or RLS started
automatically.
