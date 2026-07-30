# E05-T12 — Tenancy Query Services: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T12 only. Do not implement HTTP
  handlers, background jobs, anonymous invitation acceptance, or
  cross-organization admin features." Sections 1–15.
- **Verdict:** **Complete**, the tenancy module's full read side, exactly
  as scoped.

## What shipped

`packages/tenancy/src/application/get-organization-query.ts`,
`list-organization-members-query.ts`, `list-pending-invitations-query.ts`
— `getOrganization`/`listOrganizationMembers`/`listPendingInvitations`,
each bundled with its own DTO (`OrganizationSummary`/
`OrganizationMemberSummary`/`PendingInvitationSummary`) and explicit
aggregate-to-DTO mapper, mirroring how `create-organization.ts` already
bundles `CreateOrganizationResult` alongside `createOrganization`.

Full design writeup:
[docs/modules/tenancy-query-services.md](../modules/tenancy-query-services.md)
(query boundaries, DTO rationale, RLS assumptions, sorting guarantees,
future pagination/filtering notes).

**Tests:** 17 new tests total — 13 unit tests across three new test files
(`test/application/get-organization-query.test.ts`,
`list-organization-members-query.test.ts`,
`list-pending-invitations-query.test.ts`: DTO field mapping, sort order,
`PENDING`-only filtering, cross-organization isolation against in-memory
test doubles) and 4 new integration tests appended to the existing
`test/integration/tenancy-postgres.postgres.test.ts` (organization A
cannot see organization B through any of the three queries; platform-role
elevation does not leak into query visibility). The existing golden-path
workflow integration test was also extended, not duplicated, to call all
three queries after its accept step (Section 9).

## No new repository method — the whole task fits inside an existing seam

Section 2 forbade adding a repository method absent a proven gap, and
none was needed: `OrganizationRepository.findById`,
`MembershipRepository.listForOrganization`, and
`InvitationRepository.listForOrganization` — all three unchanged since
E05-T02/T04/T11 — are exactly what every query needed. The entire task
was: call an existing method, map the resulting aggregate to a DTO
explicitly, and (for the two list queries) filter/sort in the
application layer. This is the sharpest evidence yet that E05-T11's
signature work (threading `tx: TransactionContext` through every port
method) was the right shape — a read-side task arriving one iteration
later needed zero changes to the ports it depends on.

## `getOrganization`'s signature: a deliberate mirror, not a convenience default

The obvious, simpler signature would have been
`getOrganization(context: OrgScopedContext, deps): Promise<OrganizationSummary | null>`,
always reading `context.organizationId` as the target. Instead,
`getOrganization` takes `context` **and** a separate target
`organizationId`, exactly matching `OrganizationRepository.findById`'s
own shape. This was not an arbitrary choice: Section 8 requires proving
"organization A cannot see organization B" *at the query layer*, and the
only way to construct that scenario meaningfully is to call the query
with A's context (and a transaction genuinely scoped to A) while asking
about B's id — precisely the shape E05-T11's own repository-layer RLS
test already used for `findById`. Reusing that shape at the query layer
means the query's RLS guarantee is not a new claim to verify; it is a
direct, structural inheritance of the guarantee E05-T11 already proved.
The new integration test confirms it returns `null` for the mismatched
case and the correct DTO for the matching one.

## Why these queries still open a `UnitOfWork`, despite being read-only

A closer read of Section 3 ("no side effects") could be misread as "no
transaction." That's not available here: `docs/unit-of-work.md`'s
transaction-ownership rule means the only way to get a real
`TransactionContext`/`tx.sql` to hand to a repository method is from
inside a `UnitOfWork.run()` callback — there is no separate "read
context" mechanism in this codebase, and Section 2 forbids inventing
repository methods that would take a raw connection instead. Each
query's `deps.uow.run(async (tx) => {...})` call exists purely to reach
`tx`; nothing is ever staged on `tx.publish`, so the transaction commits
having done nothing but a read. This is documented explicitly in
tenancy-query-services.md so a future reader doesn't mistake the
`UnitOfWork` usage for an oversight.

## The elevation-leak test: proving `RESET ROLE` inside the same transaction, not across a fresh one

The fourth Section 8 requirement — "elevated uniqueness checks do not
affect query visibility" — could be satisfied trivially by calling
`existsBySlug` in one transaction and `getOrganization` in a fresh one;
a fresh connection always starts unprivileged, so that would prove
nothing new. The actual new integration test instead calls both inside
**the same** `PostgresUnitOfWork` transaction (`withUow`'s callback runs
`existsBySlug` first, confirms it sees the foreign slug via the
platform-role elevation, then calls `getOrganization` for that same
foreign organization's id using the identical `tx`) — this is the only
version of the test that actually exercises whether E05-T11's
`finally { RESET ROLE }` took effect before the next statement ran,
rather than merely confirming that isolation holds across separate
connections (which was never in doubt).

## DTO field lists: exact, with two intentional omissions

Both omissions were directive-specified, not judgment calls:
`OrganizationSummary` stops at `updatedAt` (excluding `deletedAt`, which
`Organization` itself exposes), and `OrganizationMemberSummary` excludes
`removedAt` (Section 5's explicit instruction) while still including
every membership regardless of status — the directive asks to hide the
field, not to filter the row. `PendingInvitationSummary` has no `status`
field at all, since filtering to `PENDING` happens before mapping and a
constant field would be noise.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` (via `turbo run build typecheck`)
  — 8/8 tasks pass.
- `eslint packages/tenancy` — zero findings, checked after every source
  change.
- `pnpm -r test` (via `turbo run test`) — 8/8 tasks pass, including
  tenancy's full 391-test unit suite (up from 378).
- `pnpm --filter @corestack/tenancy test:integration` — 20/20 tests pass
  (up from 16) against a real local PostgreSQL 18.4 instance, run twice
  to confirm stability; scratch-database cleanup verified (no orphaned
  `tenancy_test_*` databases after the run).
- Architecture-fitness suite — unchanged at 36 tests across 5 files (no
  new package/manifest surface).
- Export-surface snapshot — updated for the six new symbols on the
  existing `.` export condition (three query functions, three mappers);
  no new export condition, no unexpected exports.

## Permanent policy reaffirmed (Section 11)

Aggregates for commands, DTOs for queries, RLS for visibility, no
authorization logic in query services, query shape owned by the
application layer — all five describe exactly what this task built, not
an aspiration.

## What's still open, not resolved here

- **HTTP handlers, background jobs, anonymous invitation acceptance,
  cross-organization admin features** — all explicitly out of scope per
  Section 1/14.
- **No pagination, no filtering, no search** (Section 14) — both list
  queries return every matching row in one call. See
  tenancy-query-services.md's future notes for the seam a later task
  should extend, rather than reworking the repository layer.
- **`TenancyUseCases` still does not include the query services** — like
  the three write-side use cases before them, `getOrganization`/
  `listOrganizationMembers`/`listPendingInvitations` are standalone
  exported functions, not wired into `createTenancyModule`'s `useCases`.
- **Release-pipeline debt** (recurring, tracked across every prior
  report in this sequence): `@corestack/tenancy` remains `0.0.1`, no
  changeset — this task adds new public exports to the existing `.`
  condition; still not cut into a release, since `RELEASE_ENABLED` stays
  off pending a broader release decision.

## Next

**E05-T13**: not yet specified by the founder directive sequence. Not
started. Per Section 15, work stops here pending the next prompt — no
HTTP interface or background job work started automatically.
