# E05-T05 — `Invitation` Domain Model: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T05 only. Do not implement
  persistence adapters, RLS policies, migrations, HTTP handlers, or
  invitation use cases." Sections 1–15.
- **Verdict:** **Complete**, pure domain model only, exactly as scoped.

## What shipped

In `packages/tenancy/src/domain/`:

| File | Contents |
| --- | --- |
| `invitation.ts` (rewritten) | `Invitation` aggregate, `CreateInvitationInput` |
| `invitation-id.ts` | `InvitationId` value object |
| `email.ts` | `Email` value object — temporary, tenancy-local |
| `invitation-role.ts` | `InvitationRole` enum, `assertValidInvitationRole` |
| `invitation-status.ts` | `InvitationStatus` enum, `isLegalInvitationStatusTransition` |
| `invitation-events.ts` | `InvitationDomainEvent` discriminated union (4 event types) |

`OrganizationId` and `UserId` are reused directly rather than
reimplemented (Section 3).

In `packages/tenancy/src/application/invitation-repository.ts`: the two
port methods were mechanically updated to return `Invitation` instead of
the now-superseded `InvitationRecord` placeholder — the same forced fix
`OrganizationRepository`/`MembershipRepository` went through in
E05-T02/T04.

Full design writeup:
[docs/modules/invitation-domain.md](invitation-domain.md) (aggregate
boundaries, role model, status model with Mermaid diagram, invariants
table, expiry semantics, event list, future invitation-token note,
non-goals).

**Tests:** 5 new files, 83 new tests (tenancy package: 171→254 total) —
82 in the new files: creation, email normalization (trim + lowercase),
invalid email (6 malformed shapes), owner-role rejection with a
dedicated message, unrecognized-role rejection, expiry-in-the-past and
expiry-equal-to-now rejection, accept/revoke/expire (legal path plus
rejection from every terminal state), timestamp monotonicity, event
emission/ordering/suppression-on-failure, immutability (defensive-copy
getters, stable value-object equality), plus dedicated transition-table
tests for `InvitationStatus`. The other 1 was added to the existing
`index.test.ts` export smoke test for `Invitation`'s own exports —
Invitation is a wholly new domain this task added, so (unlike T04) there
was no prior-task gap to backfill here.

## No token field — a deliberate departure from the T01 placeholder

The E05-T01 scaffold's `InvitationRecord` placeholder had a `tokenHash`
field. The real `Invitation` aggregate has **none**. Section 13/14 are
explicit: token generation, hashing, and delivery are not domain
concerns. This isn't an oversight surfaced later — it was designed out
from the start, and documented in the domain doc's own "Future
invitation-token note" so a future `InviteMember` task knows a token
needs to be introduced at the application/infrastructure layer, not
retrofitted onto this aggregate.

## Two expiry rules, and one gap deliberately left open (twice, now documented in both places)

Two separate rules govern `expiresAt`:

1. **Creation-time validation**: `expiresAt` must be strictly after
   `now`, checked once in `create`.
2. **No clock comparison inside `expire()`/`accept()`.** Neither method
   compares `now` against `expiresAt` — the aggregate provides the
   *capability* to record a terminal outcome, not the *policy* of when
   that outcome is correct to apply. This mirrors `Organization.delete`/
   `Membership.remove`.

During review, I caught that my first draft of the domain doc explained
this omission only for `expire()`, leaving `accept()`'s identical
behavior implicit. Fixed before committing: both methods' docs now state
plainly that a `PENDING` invitation past its `expiresAt` is still
structurally acceptable, and a future `AcceptInvitation` use case is
responsible for the `now > expiresAt` check itself.

## `respondedAt`: one field, three terminal writers, deliberately

Section 6 lists `respondedAt?` as a single optional field, without
specifying which terminal transition(s) set it. Given the codebase's
existing precedent — `Organization.deletedAt`, `Membership.removedAt`,
each a single generic terminal timestamp — `respondedAt` is set by
**all three** terminal methods (`accept`/`revoke`/`expire`), representing
"when this invitation stopped being pending," not narrowly "when the
invitee responded." The alternative (only `accept`/`revoke` set it, since
those are human actions and `expire` is passive) was considered and
rejected for consistency with the established pattern; the choice and
its reasoning are documented in the domain doc rather than left
ambiguous.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` — all pass.
- `eslint .` — zero findings (one `import type` fix needed for
  `InvitationRole`, used only in type positions in `invitation.ts` —
  caught and fixed before this report).
- `pnpm -r test` — 619 tests across 60 files in the unit/application
  lanes (tenancy alone: 254, up from 171), plus platform's unchanged 97
  integration tests and acme-crm's unchanged 4.
- Architecture-fitness suite — unchanged at 36 tests across 5 files: no
  new package/manifest surface; none of the new `invitation*.ts`/
  `email.ts` files match `/repository/i`.
- Export-surface snapshot — updated and checked in. New exports:
  `Invitation`, `InvitationId`, `Email`, `InvitationRole`,
  `InvitationStatus`, `assertValidInvitationRole`,
  `isLegalInvitationStatusTransition`, plus the domain event types.

## Permanent policy (Section 13, adopted)

`PENDING` is the only mutable state; expiry is a domain concern but the
clock comparison that decides something has expired is not; acceptance
is a fact; revocation is terminal, symmetric with the other two outcomes;
no secret/token generation in the domain; no delivery concerns in the
domain.

## What's still open, not resolved here

- **Ownership transfer** — `InvitationRole` structurally excludes
  `OWNER`; transfer remains a separate, future application-layer
  workflow, same non-goal `membership-domain.md` already documents.
- **No wire-level `INVITATION_*` event contract exists yet** — unlike
  `Organization`/`Membership`, whose wire constants were defined in
  E05-T01, invitation event contracts were never added. A future task
  building `InviteMember`/`AcceptInvitation` needs to add that contract
  *and* the domain-to-wire mapping — flagged explicitly in the domain doc
  so this isn't mistaken for an oversight.
- **Invitation tokens, email delivery, acceptance workflow** — all
  explicitly out of scope per Section 14, tracked in the domain doc's
  non-goals and "Future invitation-token note".
- **Release-pipeline debt** (recurring, tracked across T01–T05 reports):
  `@corestack/tenancy` remains `0.0.1`, no changeset, sixth task in a row
  adding public surface. Not a blocker — `RELEASE_ENABLED` stays off.

## Two README staleness fixes caught and corrected in this task

While updating `packages/tenancy/README.md` for T05, found and fixed
leftover T04-era claims that the advisor flagged before commit: the
non-goals section still said `Invitation` was "a bare placeholder record
type" (now false), the layout block and test count were stale, and the
`MembershipRepository`-only note about the port-signature fix didn't
mention `InvitationRepository` getting the identical treatment. Also
added a short caveat to the README's "Purpose" section noting that its
three-aggregate blueprint description (from `tenancy-contract.md`)
diverges from what's actually built in specific, tracked ways — the same
class of contract-doc-vs-domain divergence already flagged twice
(`Organization`'s `kind` field, the 3-vs-4-state status model), now a
third instance (`Invitation`'s token).

## Next

**E05-T06**: not yet specified by the founder directive sequence. Not
started. Per Section 16, work stops here pending the next prompt — no
repositories, persistence, or invitation delivery started automatically.
