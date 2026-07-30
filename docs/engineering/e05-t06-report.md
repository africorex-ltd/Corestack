# E05-T06 — `inviteMember` Use Case: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T06 only. Do not implement SQL
  persistence, RLS policies, migrations, HTTP handlers, email delivery,
  or invitation acceptance." Sections 1–15.
- **Verdict:** **Complete**, application layer only, exactly as scoped.

## What shipped

In `packages/tenancy/src/application/`:

| File | Contents |
| --- | --- |
| `invite-member.ts` | `InviteMemberCommand`/`InviteMemberResult`/`InviteMemberDeps`, `inviteMember` use case |
| `cannot-invite-owner-error.ts` | `CannotInviteOwnerError` (extends `ValidationError`) |
| `invitation-already-exists-error.ts` | `InvitationAlreadyExistsError` (extends `ConflictError`) |
| `invitation-repository.ts` (modified) | added `existsPendingForEmail`, `save` |
| `config.ts` (modified) | added `invitationExpiryDays` (default 7) |
| `events.ts` (modified) | added `INVITATION_CREATED_EVENT`, `InvitationCreatedPayload` |

`OrganizationRepository`, `Invitation.create`, and `UnitOfWork` are
reused directly, not reimplemented (Section 2).

Full design writeup:
[docs/modules/invite-member-usecase.md](../modules/invite-member-usecase.md)
(command flow, sequence diagram, the client-claimed-`organizationId`
check, validation-layers table, expiry policy including the
`invitationExpiryHours`-vs-`invitationExpiryDays` config note, duplicate
handling, event flow, non-goals).

**Tests:** 1 new file, 15 new tests (tenancy package: 254→270 total) —
successful invitation, email normalization, owner-role rejection,
duplicate pending invitation, inactive-organization rejection,
organization-not-found, `organizationId` mismatch (`ForbiddenError`),
invalid email, empty `requestId`, events published on success, no events
on any failure path, expiry computed from an injected clock, repository
call counts, `UnitOfWork` usage. The remaining 1 test was added to the
existing `index.test.ts` export smoke test for `inviteMember`'s own
exports.

## `ForbiddenError` on a client-claimed `organizationId` mismatch

`inviteMember` takes `context: OrgScopedContext` as its first parameter
— unlike `createOrganization`'s plain `Context`, because inviting a
member is inherently an org-scoped operation (an org must already
exist), matching `examples/acme-crm-module`'s `createContact` pattern.
`command.organizationId` is still present on the command per Section 3,
but it is never used to construct tenant scope: it is parsed
(`OrganizationId.from`) and checked for exact equality against
`context.organizationId`. A mismatch returns `ForbiddenError`, not
`ValidationError` — an authorization signal, not malformed input. This
is firmer than E05-T03's still-open `requestedBy`-vs-`context.actor.id`
question (left unresolved for a future task) because `organizationId` is
exactly the value tenant isolation depends on — the stakes differ in
kind, not just degree.

## A config-surface tension, resolved by addition, not repurposing

`tenancyConfigSpec` already had an `invitationExpiryHours` field
(E05-T01, default 72). A search confirmed it is read by no code
anywhere. Rather than repurposing it (would silently change a shipped,
documented default — a behavior change Section 7 never asked for) or
leaving an unresolved conflict (there is none — nothing consumes the
old field), a new `invitationExpiryDays` field (default 7) was added
alongside it. `invitationExpiryDays` is the field `inviteMember`
actually reads, combined with an injected `Clock` to compute
`expiresAt` entirely inside the use case — `Invitation.create` only
ever validates the result is strictly after `now` (E05-T05's own
invariant), never computing one itself. `invitationExpiryHours` is left
exactly as built, its default untouched, its env key untouched, now
explicitly marked in `config.ts`'s own comment as
superseded-but-not-removed. Removing it is a config-surface cleanup
outside this task's scope.

## Two gaps flagged, not silently assumed solved

- **The active-membership check (Section 4 step 2)** — "verify no
  `ACTIVE` membership already exists for the email/user *if the
  repository can determine it*." It cannot: `Membership` (E05-T04) keys
  off `userId`, not email, and no `User` aggregate or repository exists
  anywhere in this codebase to resolve one into the other. Genuinely
  unrepresentable today, not skipped for convenience —
  `InviteMemberDeps` deliberately has no `membershipRepository` field.
- **Authorization — is the inviter permitted to invite?** Caught during
  review: `inviteMember` checks that `invitedBy` parses as a valid
  `UserId` and that the command's `organizationId` matches `context`,
  but never checks whether `invitedBy` is actually a member of the
  organization, let alone holds a role permitted to send invitations. As
  written, any caller holding a valid `OrgScopedContext` for
  organization X can invite into organization X regardless of their own
  membership or role. Unlike the active-membership check, this one is
  *not* unrepresentable — `MembershipRepository.listForOrganization`
  could answer "is `invitedBy` a member here" today — it is simply not
  wired into this use case. Documented explicitly in the use-case doc
  and package README as an open authorization gap, expected to be closed
  at the HTTP/policy layer or a dedicated future task.

`InvitationAlreadyExistsError` follows the same best-effort shape
`create-organization-usecase.md` already documents for `existsBySlug`:
no hard uniqueness guarantee exists until E05-T21's migration adds a
real constraint.

## Event flow

`Invitation.create()` only ever produces `InvitationCreated`. This task
adds the first `INVITATION_*` wire contract in the package —
`INVITATION_CREATED_EVENT`/`InvitationCreatedPayload` — since E05-T01
only defined organization/member contracts and E05-T05's own domain doc
flagged this exact gap. `role` is typed `"ADMIN" | "MEMBER"` against the
real uppercase `InvitationRole` values, deliberately not perpetuating
`MemberJoinedPayload.role`'s lowercase T01-era mismatch. `expiresAt` is a
JSON-serializable ISO string, not a `Date` — nested payload `Date`
fields aren't auto-reconstructed on deserialization, unlike the
envelope's own `occurredAt`.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` — all pass.
- `eslint .` — zero findings (one unused-import fix needed —
  `OrganizationStatus` imported but never referenced in
  `invite-member.test.ts` — caught and fixed before this report).
- `pnpm -r test` — 635 tests across 61 files in the unit/application
  lanes (tenancy alone: 270, up from 254), plus platform's unchanged 97
  integration tests and acme-crm's unchanged 4.
- Architecture-fitness suite — unchanged at 36 tests across 5 files: no
  new package/manifest surface; none of the new
  `invite-member.ts`/`cannot-invite-owner-error.ts`/
  `invitation-already-exists-error.ts` files match `/repository/i`.
- Export-surface snapshot — updated and checked in. New exports:
  `inviteMember`, `InviteMemberCommand`, `InviteMemberResult`,
  `InviteMemberDeps`, `CannotInviteOwnerError`,
  `InvitationAlreadyExistsError`, `INVITATION_CREATED_EVENT`,
  `InvitationCreatedPayload`.

## Permanent policy (Section 12, adopted)

Delivery is infrastructure; expiry is application policy, not a domain
concern; acceptance is a separate future use case; duplicate checks stay
best-effort until database constraints exist; clocks are injected, never
read globally.

## What's still open, not resolved here

- **The active-membership check** and **inviter authorization** — see
  above; both documented in the use-case doc's non-goals and the package
  README.
- **A hard duplicate-invitation guarantee** — E05-T21's job.
- **Wiring into `createTenancyModule`'s `useCases`** — `TenancyUseCases`
  remains `Record<string, never>`.
- **The 3-state vs. 4-state organization-model reconciliation** —
  explicitly untouched (Section 13); `Organization.status` is read (must
  be `ACTIVE`) but the status model itself is unchanged.
- **Removing the now-superseded `invitationExpiryHours` config field** —
  a cleanup task, not this one.
- **Repository adapters, SQL, RLS, migrations, HTTP handlers, email
  delivery, invitation acceptance, token generation** — all explicitly
  out of scope per Section 13.
- **Release-pipeline debt** (recurring, tracked across T01–T06 reports):
  `@corestack/tenancy` remains `0.0.1`, no changeset, seventh task in a
  row adding public surface. Not a blocker — `RELEASE_ENABLED` stays off.

## Next

**E05-T07**: not yet specified by the founder directive sequence. Not
started. Per Section 15, work stops here pending the next prompt — no
SQL persistence, repository adapters, migrations, RLS, or HTTP handlers
started automatically.
