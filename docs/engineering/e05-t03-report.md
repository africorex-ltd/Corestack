# E05-T03 — `createOrganization` Use Case: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T03 only. Do not implement SQL
  persistence, RLS policies, migrations, or HTTP handlers." Sections 1–13.
- **Verdict:** **Complete**, application layer only, exactly as scoped.

## What shipped

In `packages/tenancy/src/application/`:

| File | Contents |
| --- | --- |
| `create-organization.ts` | `CreateOrganizationCommand`, `CreateOrganizationResult`, `CreateOrganizationDeps`, `createOrganization()` |
| `duplicate-slug-error.ts` | `DuplicateSlugError` (extends kernel's `ConflictError`) |
| `organization-repository.ts` (extended) | `existsBySlug(context: Context, slug: OrganizationSlug)`, `save(context: Context, organization: Organization)` |
| `events.ts` (fixed) | `OrganizationCreatedPayload` — dropped `kind` |

Full design writeup: [docs/modules/create-organization-usecase.md](create-organization-usecase.md)
(command flow, sequence diagram, three validation layers, duplicate
handling, event flow, non-goals).

**Tests:** 1 new file, 15 new tests (tenancy package: 79→94 total) —
successful creation, duplicate slug (no aggregate/persist/publish),
trimming, event publication and suppression-on-failure, repository call
counts, `UnitOfWork.run` usage (via `vi.spyOn`), timestamp preservation,
requestedBy/requestId validation.

## Two design decisions worth recording

**Repository methods take plain `Context`, not `OrgScopedContext`.**
`existsBySlug`/`save` can't require an org scope — creating an
organization is the operation that produces one; there is no scope yet to
require. The pre-existing `findById`/`listForContext` (T01) keep
`OrgScopedContext`, untouched, since Section 2 didn't ask to revisit them.

**The repository takes no `sql`/transaction handle**, unlike
`examples/acme-crm-module`'s `ContactRepository.create(tx: TransactionSql, ...)`.
Using that pattern here would require depending on
`@corestack/platform/postgres` before any Postgres adapter exists for
this module — exactly the infrastructure coupling Section 1 says this
task exists to avoid. The use case depends on the generic kernel
`UnitOfWork` (`tx.publish(...)` only), not `PostgresUnitOfWork`. How a
future `PostgresOrganizationRepository` binds itself to the active
transaction is left as E05-T21's problem, noted explicitly in the
repository port's own comment so it isn't mistaken for an oversight.

## A forced, mechanical fix to already-shipped code

Mapping `Organization.pullDomainEvents()`'s `OrganizationCreated` fact to
a wire-level event (Section 7) required constructing
`OrganizationCreatedPayload` (E05-T01) — which required a `kind: "personal"
| "team"` field the `Organization` aggregate (E05-T02) simply doesn't
have. This wasn't a design choice to defer; it didn't compile. Per
Section 13's instruction to preserve the current domain model, the fix
was to the wire type, not the aggregate: `kind` is dropped from
`OrganizationCreatedPayload`. Recorded in the type's own comment and in
`application/events.ts`.

## A caveat surfaced, not silently assumed away

Section 4 requires the whole flow inside one `UnitOfWork.run()` call,
which the implementation does. But this is **not yet a hard
slug-uniqueness guarantee** — the in-memory reference adapter has no
isolation, and even a real Postgres transaction doesn't prevent two
concurrent requests from both passing `existsBySlug` before either
`save`s without a unique constraint on the slug column, which doesn't
exist until E05-T21's migration. `existsBySlug` today is a best-effort,
friendly-error check, not a correctness guarantee. This is written down
explicitly in the use-case doc's non-goals and in this report, rather
than left implicit in a comment that reads more confident than the code
actually is.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` — all pass.
- `eslint .` — zero findings (one `import type` fix needed in the new test
  file; caught and fixed before this report).
- `pnpm -r test` — 459 tests across 50 files in the unit/application
  lanes (tenancy alone: 94, up from 79), plus platform's unchanged 97
  integration tests and acme-crm's unchanged 4.
- Architecture-fitness suite — unchanged at 36 tests across 5 files: no
  new package/manifest surface; neither new file matches `/repository/i`.
- Export-surface snapshot — updated and checked in. New exports:
  `createOrganization`, `DuplicateSlugError`, plus the command/result/deps
  types.

## Permanent policy (Section 11, adopted)

Repositories are ports; `UnitOfWork` owns event publication; aggregates
emit events; use cases coordinate and contain no domain rules;
application errors are typed; results are DTOs, not aggregates.
`createOrganization` is the first instance, not just the policy
statement.

## Release-pipeline debt (not fixed here, not new)

Still no changeset for `@corestack/tenancy`, still `0.0.1` while kernel/
platform are `0.1.0`. Fourth task in a row adding public surface to an
unversioned publishable package. Not a blocker — `RELEASE_ENABLED` stays
off — but the pattern is now well-established and should be reconciled
before any real publish.

## Next

**E05-T04**: not yet specified by the founder directive sequence
(the original blueprint numbering would suggest `Membership`, but this
session's directives have resequenced tasks — `CreateOrganization` arrived
as T03 ahead of any `Membership` work). Not started. Per Section 14, work
stops here pending the next prompt.
