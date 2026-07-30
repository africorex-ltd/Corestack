# E05-T04 — `Membership` Domain Model: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T04 only. Do not implement
  persistence adapters, RLS policies, migrations, HTTP handlers, or
  invitation flows." Sections 1–15.
- **Verdict:** **Complete**, pure domain model only, exactly as scoped.

## What shipped

In `packages/tenancy/src/domain/`:

| File | Contents |
| --- | --- |
| `membership.ts` (rewritten) | `Membership` aggregate, `CreateMembershipInput` |
| `membership-id.ts` | `MembershipId` value object |
| `user-id.ts` | `UserId` value object — temporary, tenancy-local (see below) |
| `membership-role.ts` | `MembershipRole` enum, `isLegalMembershipRoleTransition` |
| `membership-status.ts` | `MembershipStatus` enum, `isLegalMembershipStatusTransition` |
| `membership-events.ts` | `MembershipDomainEvent` discriminated union (6 event types) |

`Organization.organizationId`'s type, `OrganizationId`, is reused directly
on `Membership` rather than reimplemented (Section 3).

In `packages/tenancy/src/application/membership-repository.ts`: the two
port methods were mechanically updated to return `Membership` instead of
the now-superseded `MembershipRecord` placeholder — the same forced fix
`OrganizationRepository` went through in E05-T02, not new scope.

Full design writeup:
[docs/modules/membership-domain.md](membership-domain.md) (aggregate
boundaries, role model with Mermaid diagram, status model with Mermaid
diagram, invariants table, event list, ownership-transfer non-goal,
examples).

**Tests:** 5 new files, 77 new tests (tenancy package: 94→171 total) — 75
in the new files: creation (including direct-to-`OWNER` construction),
invalid-id rejection for all three id types, promote/demote (legal path,
owner rejection, self-transition rejection, removed-membership
rejection), suspend/reactivate (legal path, self-transition rejection,
removed-membership rejection, owner-can-be-suspended), remove (legal
path, owner rejection regardless of status, terminal-removal rejection),
timestamp monotonicity, event emission/ordering/suppression-on-failure,
immutability (defensive-copy getters, stable value-object equality), plus
dedicated transition-table tests for both `MembershipRole` and
`MembershipStatus`. The other 2 were backfilled into the existing
`index.test.ts` export smoke test — one for `Membership`'s exports (this
task's own scope), and one for `createOrganization`'s exports, which
E05-T03's own smoke-test update missed. Caught while in the file for this
task, not a new gap introduced by it.

## Role and status are independent axes

`Membership` tracks two things that don't interact: `role`
(`OWNER`/`ADMIN`/`MEMBER`) and `status` (`ACTIVE`/`SUSPENDED`/`REMOVED`).
Suspending or reactivating never touches role — an `OWNER` can be
suspended and reactivated, since nothing in Section 4/5 forbids that,
only demotion and removal are locked. Promoting or demoting never touches
status. This is stated explicitly in the doc and tested directly (`"an
OWNER can be suspended and reactivated (role is untouched by status
changes)"`).

## Owner lock: two different enforcement mechanisms, by necessity

Section 4's two owner rules are enforced differently because they're
different kinds of rule:

- **"Owner cannot be downgraded"** is expressible as a transition-table
  fact: `MembershipRole.Owner` simply has no outgoing entries in
  `LEGAL_ROLE_TRANSITIONS`. `promoteToAdmin`/`demoteToMember` both go
  through the same `#transitionRole` check as any other call and fail
  the same generic way `Organization`'s `#transitionTo` does for
  `DELETED`.
- **"Owner cannot be removed"** is *not* a transition-table fact, because
  `REMOVED` is a legal target from both `ACTIVE` and `SUSPENDED` for
  every role — the illegality depends on the *role*, not the *status*
  transition. `remove()` checks `this.#role === MembershipRole.Owner`
  explicitly, before consulting the status table at all. Tested directly:
  removing a *suspended* owner still throws the owner-specific error, not
  a status-transition error, proving the role check runs first.

## A temporary, explicitly-flagged value object: `UserId`

Section 3 asked to introduce `UserId` only if none exists in a shared
package, and to document the choice if introduced. Searched
`@corestack/kernel` and `@corestack/platform` first — confirmed empty
before writing any code, the same discipline used for E05-T02's
event-pattern premise. `UserId` now exists, but scoped to
`@corestack/tenancy`'s own domain layer only, not exported as a shared
identity primitive. Its own file comment and `membership-domain.md` both
say plainly: if a real identity module ever introduces its own `UserId`,
this one should be deleted and `Membership` updated to import that one
instead. Not silently assumed to be the permanent home for user identity.

## A forced, mechanical fix to already-shipped code (same shape as T03's)

`MembershipRepository` (E05-T01) referenced the placeholder
`MembershipRecord` type, which this task's rewrite of `membership.ts`
removed. The two port methods (`findById`, `listForOrganization`) now
return `Membership` instead. This is not new repository scope — it's the
same category of forced, compile-time-driven fix `OrganizationRepository`
needed in E05-T02, applied here for consistency and because leaving a
reference to a deleted type would not compile.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` — all pass.
- `eslint .` — zero findings.
- `pnpm -r test` — 536 tests across 55 files in the unit/application
  lanes (tenancy alone: 171, up from 94), plus platform's unchanged 97
  integration tests and acme-crm's unchanged 4.
- Architecture-fitness suite — unchanged at 36 tests across 5 files: no
  new package/manifest surface; none of the new `membership*.ts`/
  `user-id.ts` files match `/repository/i`.
- Export-surface snapshot — updated and checked in. New exports:
  `Membership`, `MembershipId`, `UserId`, `MembershipRole`,
  `MembershipStatus`, `isLegalMembershipRoleTransition`,
  `isLegalMembershipStatusTransition`, plus the domain event types.

## Permanent policy (Section 13, adopted)

Ownership rules are explicit (transition-table absence for downgrade,
dedicated guard for removal); terminal states are enforced structurally;
role/status transitions are intentional, named methods; events describe
facts; no infrastructure in domain code; no speculative shared base
classes — `pullDomainEvents`/`clearDomainEvents` remain hand-written per
aggregate, exactly as `Organization` established and Section 9 required.

## What's still open, not resolved here

- **Ownership transfer** — no method moves `OWNER` between memberships;
  this needs an application-layer use case coordinating two aggregate
  instances, which a single `Membership` cannot express on itself.
  Flagged in `membership-domain.md`'s non-goals, not designed.
- **`Invitation`** — still the E05-T01 placeholder record type; untouched
  per Section 15.
- **The 3-state vs. 4-state `Organization` status reconciliation**
  (E05-T02's open item) — irrelevant to this task's scope, untouched.
- **Release-pipeline debt** (recurring, tracked across T01–T04 reports):
  `@corestack/tenancy` remains `0.0.1`, no changeset, fifth task in a row
  adding public surface. Not a blocker — `RELEASE_ENABLED` stays off.

## Next

**E05-T05**: not yet specified by the founder directive sequence. Not
started. Per Section 16, work stops here pending the next prompt — no
repositories, persistence, or invitation flows started automatically.
