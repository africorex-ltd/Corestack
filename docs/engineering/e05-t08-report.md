# E05-T08 — Tenancy Workflow Integration Harness: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T08 only. Do not implement SQL
  persistence, RLS policies, migrations, Drizzle schemas, or HTTP
  handlers." Sections 1–13.
- **Verdict:** **Complete**, in-memory integration harness only, exactly
  as scoped.

## What shipped

In `packages/tenancy/test-support/` (new directory, sibling to `test/`,
outside the public `src/` surface):

| File | Contents |
| --- | --- |
| `in-memory-organization-repository.ts` | `InMemoryOrganizationRepository implements OrganizationRepository` |
| `in-memory-membership-repository.ts` | `InMemoryMembershipRepository implements MembershipRepository` |
| `in-memory-invitation-repository.ts` | `InMemoryInvitationRepository implements InvitationRepository` |
| `event-collector.ts` | `EventCollector` — ordered event capture + assertions |
| `workflow-harness.ts` | `TenancyWorkflowHarness` — wires repositories, `UnitOfWork`, `FixedClock`, `EventCollector`, config |

`packages/tenancy/tsconfig.json`'s `include` gained `"test-support"`.

In `packages/tenancy/test/workflow/`:

| File | Contents |
| --- | --- |
| `tenancy-workflow.test.ts` | 13 end-to-end integration tests |

Full design writeup:
[docs/modules/tenancy-workflow-integration.md](../modules/tenancy-workflow-integration.md)
(why `test-support/` not `src/testing/`, repository behavior, harness
design, event capture, a happy-path sequence diagram, an event-timeline
table, a repository-interactions-per-use-case table, transaction
semantics, a failure-semantics summary table, non-goals).

**Tests:** 1 new test file, 13 new tests (tenancy package: 294→307
total, 20→21 files) — happy path (create → invite → accept, exact event
sequence asserted), duplicate slug, duplicate pending invitation,
expired invitation, revoked invitation, the full inviter-authorization
matrix (unauthorized inviter, admin→member, admin cannot invite admin,
owner→admin), exactly-once invitation consumption / membership
creation, and three transaction-semantics tests (Section 7).

**No new public exports.** Unlike T02–T07, the api-surface snapshot
test (`test/api-surface.test.ts`) required no regeneration — it passed
unchanged, confirming `test-support/` correctly stays outside the
package's public surface.

## Why `test-support/`, not `src/testing/`

The package already has a reserved, empty `src/testing/` barrel with a
declared `./testing` export condition, earmarked for E05-T28's
adopter-facing fixtures. Using it now would prematurely resolve that
task's still-open design and would put these in-memory repositories
inside every architecture-fitness rule that scans `src/`
(`tenant-isolation.test.mjs`'s repository-org-scoping checks,
`contract-suite-adapter-matrix.test.mjs`'s port-adapter scan). Instead,
`test-support/` follows the precedent already established by
`packages/platform/test-support/test-database.ts`: sibling to `test/`,
included in `tsconfig.json`, invisible to adopters and to every
`src/`-scoped fitness rule.

## Repository behavior — and two deliberate non-additions

Each in-memory repository implements its existing port exactly, using
copy-on-write `Map` storage (`save()` replaces the map rather than
mutating it in place, so any array a prior `list*`/`find*` call
returned stays valid).

**Deliberately did not add** `OrganizationRepository.findBySlug` or
`MembershipRepository.findByOrganizationAndUser`, despite Section 3 of
the founder directive suggesting both:

- No Section 6 scenario resolves an organization by slug —
  `createOrganization` returns `organizationId` directly, and every
  later call scopes off that id.
- The existing `findByUserId(context: OrgScopedContext, userId)`
  (added in E05-T07) already **is** "find by organization and user,"
  since `context.organizationId` supplies the organization half. A
  second method under a different name for identical behavior would be
  a duplicate — the same judgment E05-T07 already applied when it
  deliberately skipped `InvitationRepository.findPendingById`.

## The harness — explicit, not a DI framework (Section 12)

`TenancyWorkflowHarness` is a plain class with public readonly fields
(`clock`, `events`, `ids`, `uow`, `config`, and the three in-memory
repositories) — no container, no registration step, no interface beyond
the one the class itself defines. All three use-case wrapper methods
(`createOrganization`, `inviteMember`, `acceptInvitation`) share one
`UnitOfWork`/`EventBus` pair, matching how a real composition root
wires one module's use cases and letting a single `harness.events`
collector observe the entire workflow's event timeline across multiple
use-case calls.

## Transaction semantics (Section 7) — proved, not just documented

Rather than merely asserting in prose that the in-memory `UnitOfWork`
lacks storage-rollback semantics, a dedicated test
(`test/workflow/tenancy-workflow.test.ts`, "a mid-flow repository
failure leaves partial state") makes it concrete: a synthetic
`ThrowingInvitationRepository` wraps the real
`InMemoryInvitationRepository`, overriding only `save` to throw.
Calling `acceptInvitation` directly with this substituted dependency
confirms:

- The overall call rejects.
- `membershipRepository.save` (called before the throwing
  `invitationRepository.save`) **did** persist — no rollback.
- `harness.events.expectNone()` holds — `InMemoryUnitOfWork.run` awaits
  `work(tx)` before calling `bus.publish(staged)`, so event-staging
  atomicity held even though storage did not.

This is a real limitation the in-memory `UnitOfWork` has, not a bug in
this task's scope to fix: closing it is `PostgresUnitOfWork`
(E03-T40)'s job via a real SQL transaction wrapping both repository
writes, out of scope per Section 1 ("before persistence is
introduced"). Section 11's "transaction semantics are validated" is
read as "validated for the properties the in-memory path can actually
provide," not as proof the eventual Postgres adapter will roll back
correctly.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` — all pass; tenancy typechecked
  clean on the first attempt.
- `eslint .` — zero findings (one fix needed along the way: a
  type-only import in `tenancy-workflow.test.ts` that eslint flagged
  for `@typescript-eslint/consistent-type-imports`, corrected to
  `import type`).
- `pnpm -r test` — 672 tests across 63 files in the unit/application
  lanes (tenancy alone: 307, up from 294), plus platform's unchanged 97
  integration tests and acme-crm's unchanged 4.
- Architecture-fitness suite — unchanged at 36 tests across 5 files: no
  new package/manifest surface, and `test-support/` sits outside every
  rule's `src/`-scoped file scan by design.
- Export-surface snapshot — **unchanged**, no regeneration needed; this
  task adds zero new public exports.

## Permanent policy (Section 10, adopted)

Workflow-level tests are written against in-memory repositories before
any SQL adapter exists; integration tests use a fixed clock for every
time-dependent assertion; event order is asserted with exact sequences,
never "contains"; a failure path leaves no partial state where the
`UnitOfWork` can prevent it, and where it cannot (storage across
multiple repository writes), that limitation is proved with a test, not
left to prose; repositories remain freely replaceable behind their
existing ports.

## What's still open, not resolved here

- **Storage-level transaction rollback.** Proved absent in the
  in-memory path (see above); `PostgresUnitOfWork`'s job.
- **The two candidate repository-port methods** (`findBySlug`,
  `findByOrganizationAndUser`) — deliberately not added; revisit only
  if a future scenario actually needs them.
- **Multiple memberships per user over time.** The in-memory
  `MembershipRepository`'s `findByUserId` assumes at most one
  membership id per user per organization — documented as a
  simplification, not a port change.
- **Wiring into `createTenancyModule`'s `useCases`** — unchanged,
  `TenancyUseCases` remains `Record<string, never>`.
- **Repository adapters, SQL, RLS, migrations, Drizzle schemas, HTTP
  handlers** — all explicitly out of scope per Section 12.
- **Release-pipeline debt** (recurring, tracked across T01–T07
  reports): `@corestack/tenancy` remains `0.0.1`, no changeset — but for
  the first time in this sequence, this task adds **no new public
  exports**, so there is nothing new for a release train to capture
  yet. Not a blocker — `RELEASE_ENABLED` stays off.

## Next

**E05-T09**: not yet specified by the founder directive sequence. Not
started. Per Section 13, work stops here pending the next prompt — no
Postgres persistence, RLS, migrations, Drizzle schemas, or HTTP
handlers started automatically.
