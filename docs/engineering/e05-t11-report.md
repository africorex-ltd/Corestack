# E05-T11 — Tenancy Real Postgres Repository Adapters: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T11 only. Do not implement HTTP
  handlers, background jobs, anonymous invitation acceptance, or
  cross-organization admin features." Sections 1–16.
- **Verdict:** **Complete**, real Postgres persistence for all three
  repository ports, exactly as scoped.

## What shipped

`packages/tenancy/src/infrastructure/postgres/postgres-{organization,
membership,invitation}-repository.ts` — `PostgresOrganizationRepository`/
`PostgresMembershipRepository`/`PostgresInvitationRepository`, exported
from a new `@corestack/tenancy/postgres` subpath alongside the E05-T10
RLS generators and role bootstrap.

Full design writeup:
[docs/modules/tenancy-postgres-adapters.md](../modules/tenancy-postgres-adapters.md)
(transaction boundaries, mapper strategy, RLS assumptions, constraint
translation, operational considerations, known limitations).

**Tests:** 17 new tests total — 1 added to the existing export-surface
snapshot suite (the new `./postgres` subpath) and a new 16-test
integration file
(`test/integration/tenancy-postgres.postgres.test.ts`, run via
`pnpm test:integration` against real PostgreSQL 18): 14 direct repository
tests (save+load round-trips, slug/active-membership/pending-invitation
uniqueness via real constraint violations, RLS isolation in both
directions, soft-delete behavior, timestamp and enum round-trips) and 2
workflow-level tests reusing `TenancyWorkflowHarness` (Section 10 —
create→invite→accept golden path, duplicate-slug rejection through the
full use case).

## The transaction-threading problem, and why every port signature changed

The founder directive's Section 2 scoped this task to repository
adapters, mappers, and integration tests — not use-case changes. But
building the adapters immediately hit a real, structural problem: every
existing repository port method (`findById`, `save`, etc.) took no
transaction/connection parameter at all, by design, per T03's own
documented reasoning ("that would require depending on
`@corestack/platform/postgres` before any Postgres adapter exists...
infrastructure coupling E05-T03 exists to avoid"). That reasoning was
correct when there was no adapter — but now there is one, and
`docs/unit-of-work.md`'s own "Transaction ownership" rule is
unambiguous: *"Inside a `UnitOfWork.run()` callback, use `ctx.sql` for
repository queries. Do not open a second transaction here."* Every
method on all three use cases runs entirely inside one
`uow.run(async (tx) => {...})` call, so every repository call inside them
needed a way to reach that same open transaction — there is no reading
of the existing ports that makes this work without a signature change.

**Resolution**: every port method gains `tx: TransactionContext` as its
first parameter — the generic kernel type (`{ publish }`), not a
Postgres-specific one, so the ports stay adapter-agnostic. The Postgres
adapters narrow `tx` to `PostgresTransactionContext` internally to reach
`.sql`; the in-memory repositories ignore the parameter. This cascaded
into all three use cases (threading `tx` from their own `uow.run()`
callback into every repository call), the three in-memory repositories,
and every test double across four test files — mechanical, low-risk
changes verified by the existing 377-test unit suite staying green
before any Postgres code was written (confirmed as its own checkpoint,
per the advisor's sequencing recommendation).

## The `existsBySlug`/`findBySlug` RLS problem, found empirically before writing code

Before writing any adapter code, three empirical facts were checked
against a real PostgreSQL 18.4 instance (a throwaway spike script, not
committed) rather than assumed:

1. **Does `current_setting('app.current_org')` really throw when unset,
   under the app role?** Confirmed: `SQLSTATE 42704`, "unrecognized
   configuration parameter" — already implied by an existing certified
   test (`org-scoped-repository.postgres.test.ts`), but verified again
   directly.
2. **The exact unique-violation error shape** — `SQLSTATE 23505`,
   `error.constraint_name`/`table_name`/`schema_name`/`detail` all
   present as plain string properties on `postgres.js`'s thrown error.
3. **Can `SET LOCAL ROLE` work for a directly-authenticated (non-
   superuser) connection?** Confirmed it requires an explicit
   `GRANT role TO other_role` — and confirmed, critically, that a
   *plain* (`WITH INHERIT TRUE`, the PG16+ default) grant silently and
   permanently disables tenant isolation for the granted role, because
   Postgres evaluates RLS against the union of every role a session
   belongs to when membership inherits. `WITH INHERIT FALSE` was the
   fix, verified to both prevent the automatic leak and still allow the
   intended, explicit `SET LOCAL ROLE` elevation.

These facts directly resolved a real design problem: ADR-0024's
`organizations` visibility model (id-keyed, per-organization) means
`existsBySlug`/`findBySlug` — which must see across *every* organization
to check a slug — are structurally blind under the app role. The
resolution, `existsBySlug`/`findBySlug` elevating to `tenancy_platform`
via `SET LOCAL ROLE` for their one query each, then reverting
immediately, would have been unsafe to ship without fact #3 — an
inheriting grant looked like the obvious first attempt and would have
been a real tenant-isolation regression.

## ADR-0025: correcting ADR-0024's constructor-parameter claim

Building `save()` surfaced a second problem: ADR-0024 states `app.current_org`
gets set "via `PostgresUnitOfWork`'s constructor parameter" for
organization creation — but the constructor argument is fixed before
`.run()` is called, while `createOrganization`'s own code generates the
new organization's id *inside* the callback (`Organization.create({ id:
deps.ids.generate(), ... })`). There is no way for the constructor to
have been given an id that doesn't exist yet.

[ADR-0025](../adr/0025-organization-save-sets-own-org-context.md)
corrects this: `save()` issues `SELECT set_config('app.current_org', $1,
true)` itself, using `organization.id`, as its own first statement,
inside the same already-open transaction — not a new one (Section 3
compliant). This makes `save` self-sufficient regardless of whether the
enclosing `PostgresUnitOfWork` was constructed with `organizationId:
null` (the creation case) or the real org id (an update case).

## Constraint translation, wired all the way through

Section 8 asked for database uniqueness violations to be "translated
into domain-level repository outcomes where possible." Beyond building
the translation helper (`constraint-violation.ts`, `SQLSTATE 23505` +
`constraint_name`), this task also updated all three use cases
(`createOrganization`/`inviteMember`/`acceptInvitation`) to catch their
own `save()` call and convert the translated error into `Result.err(...)`
— using error types each use case's `Result` union already declared, so
no use case signature changed. Without this, a genuine race (both
callers pass the best-effort `exists*` check, one loses at the database)
would have surfaced as an unhandled promise rejection instead of the
graceful `Err` the use case's own contract promises.

## A real, previously-undiscovered config defect, fixed in passing

`packages/tenancy`'s own `vitest.config.ts` (E05-T01) excludes
`test/integration/**` unconditionally — including when that path is
explicitly passed on the CLI, because Vitest's `--exclude` flag *adds
to* a config file's `exclude` list rather than replacing it.
`pnpm test:integration` could never have actually run a test before this
task, since tenancy had no integration test file to expose the bug until
now. Fixed with a dedicated `vitest.integration.config.ts` (include-only,
no conflicting exclude) and an updated `test:integration` script using
`--config`. Noted here as a defect found and fixed, not something this
task introduced.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` (via `turbo run build typecheck`)
  — 8/8 tasks pass.
- `eslint .` — zero findings.
- `pnpm -r test` (via `turbo run test`) — 8/8 tasks pass, including
  tenancy's full 378-test unit suite.
- `pnpm --filter @corestack/tenancy test:integration` — 16/16 tests pass
  against a real local PostgreSQL 18.4 instance, run twice to confirm
  stability; scratch database cleanup verified (no orphaned
  `tenancy_test_*` databases after the run).
- Architecture-fitness suite — unchanged at 36 tests across 5 files.
- Export-surface snapshot — updated for the new `./postgres` subpath (3
  exports: repositories, mappers, role/RLS/constraint-violation helpers)
  — no unexpected exports.

## Permanent policy reaffirmed (Section 12)

Mappers are explicit (no inline row/aggregate conversion in any
repository method); repositories contain no authorization logic; RLS is
the isolation boundary (no repository method duplicates a policy's
`WHERE organization_id = ...` filter); `UnitOfWork` owns transaction
scope (no repository opens its own transaction — the one exception,
`existsBySlug`/`findBySlug`'s role elevation, changes role, not
transaction, on the already-open one); workflow tests are reused across
adapters (`TenancyWorkflowHarness`'s new `repositories`/`uowFactory`
options, not a duplicated Postgres-specific scenario suite).

## What's still open, not resolved here

- **HTTP handlers, background jobs, anonymous invitation acceptance,
  cross-organization admin features** — all explicitly out of scope per
  Section 1/14.
- **`findByUserId`'s "current membership" semantics** for the rare
  multi-row-per-user case remain a best-effort ordering choice
  (`updated_at DESC LIMIT 1`), not a settled design decision — flagged
  in the design doc, not silently assumed correct.
- **Real per-role production credentials** remain the same open
  residual risk (R3) `docs/security/tenant-isolation-certification.md`
  already tracks — this task's integration tests use the same
  test-only temporary-login-password pattern E03-T31/acme-crm-module
  already established.
- **A permanent, on-every-schema-change DDL generation pipeline**
  remains unbuilt (E05-T10's own unresolved item, unrelated to this
  task specifically).
- **Release-pipeline debt** (recurring, tracked across every prior
  report in this sequence): `@corestack/tenancy` remains `0.0.1`, no
  changeset — this task adds a new public export condition
  (`./postgres`), which is new public surface; still not cut into a
  release, since `RELEASE_ENABLED` stays off pending a broader release
  decision, not something this task should force.

## Next

**E05-T12**: not yet specified by the founder directive sequence. Not
started. Per Section 16, work stops here pending the next prompt — no
HTTP interface or background job work started automatically.
