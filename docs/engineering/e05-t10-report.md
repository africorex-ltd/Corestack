# E05-T10 — Tenancy Row-Level Security Policy Design: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T10 only. Do not implement
  repository adapters, SQL query methods, or HTTP handlers." Sections
  1–15.
- **Verdict:** **Complete**, RLS policy design + migration artifacts
  only, exactly as scoped.

## What shipped

In `packages/tenancy/src/infrastructure/postgres/rls/` (new, internal —
no `./postgres` package export yet):

| File | Contents |
| --- | --- |
| `roles.ts` | `TENANCY_APP_ROLE` (`tenancy_app`), `TENANCY_PLATFORM_ROLE` (`tenancy_platform`) |
| `org-scoped-table-policies.ts` | `buildOrgScopedTableRlsDdl` — per-command RLS DDL for `memberships`/`invitations` |
| `organizations-policies.ts` | `buildOrganizationsRlsDdl` — RLS DDL for `organizations` (direct visibility, ADR-0024) |
| `index.ts` | Barrel (internal) |

Plus `packages/tenancy/src/infrastructure/postgres/ensure-tenancy-postgres-roles.ts`
(`ensureTenancyModuleRoles` — idempotent role bootstrap + the
`platform.outbox` grant `PostgresUnitOfWork`'s event staging needs) and
the real migration,
`packages/tenancy/migrations/tenancy/0002_create-tenancy-tables.sql`.

Full design writeup:
[docs/modules/tenancy-rls-design.md](../modules/tenancy-rls-design.md)
(policy matrix, visibility model, fail-closed behaviour, future
anonymous-acceptance and cross-org-admin non-goals, repository
assumptions, operational considerations).

**Tests:** 2 new test files, 47 new tests (tenancy package: 330→377
total, 22→24 files), no live database:

- `test/infrastructure/rls-policies.test.ts` (40 tests) — DDL-text
  assertions on the generator functions: ENABLE before FORCE ordering;
  at least one policy; stable per-command policy names; DELETE never
  granted or policied for the app role; `platform_full_access` present
  and unconditional; `current_setting` used without `missing_ok`
  (fail-closed); no bind-parameter placeholders; unsafe-identifier
  rejection; and (added during the bug-fix pass below) no
  schema/table-qualified column references anywhere in any statement.
- `test/infrastructure/migration-rls-consistency.test.ts` (7 tests) —
  parses the real migration file via `@corestack/platform`'s
  `parseMigrationFile`, then cross-checks its text against the
  generators' own output (whitespace-normalized), confirms DELETE is
  never granted to `tenancy_app`, and confirms `tenancy_platform` is
  granted `SELECT` only.

## ADR-0024: `organizations`' RLS uses direct visibility

Section 4 asks this task to resolve the visibility question E05-T09
flagged as open, choosing between membership-driven (A), direct (B), or
hybrid (C) visibility, while supporting four capabilities: reading the
current organization, reading organizations the user belongs to, future
ownership transfer, and future cross-organization administration.

**Decision, written up as
[ADR-0024](../adr/0024-tenancy-organizations-rls-direct-visibility.md):**
direct (Option B) — `id = current_setting('app.current_org')::uuid`,
identical across `SELECT`/`INSERT`/`UPDATE`. Both A and C were rejected
because they require a currently-nonexistent user-identity session
variable (`app.current_user` or equivalent); introducing one would
itself violate Section 3's "do not introduce a new mechanism." All four
required capabilities are still satisfiable — "reading organizations the
user belongs to" is deferred to a future platform-role query (the same
legitimately-cross-tenant pattern the platform role already exists for),
not silently dropped.

**`INSERT` uses the identical predicate as `SELECT`/`UPDATE`, no
special-cased creation bypass** — `Organization.id` is
application-generated before persistence, so the future adapter sets
`app.current_org` from the aggregate's own id for every `save` call,
creation included.

## A note on Section 3's literal wording, surfaced for confirmation

Section 3 names the session variable as
`current_setting('app.current_organization_id')`. Every policy this task
ships instead uses `app.current_org` — the platform's actual, sole,
already-certified mechanism (used everywhere else in this codebase; the
literal name Section 3 gives appears nowhere before this task). Section
3's other clause — "do not introduce a new mechanism" — is unambiguous
and already-tested; a second, differently-named session variable would
itself violate it. This is documented in ADR-0024 and the design doc, and
is surfaced here explicitly: **if a rename to
`app.current_organization_id` is actually wanted, that is a distinct,
larger task** (every other certified tenant-isolation call site would
need to move in lockstep) and should be requested explicitly rather than
assumed from this task's own wording.

## A real bug found during review, fixed before commit

An advisor review of this task's initial output caught a genuine defect:
every `CHECK` constraint and every `CREATE POLICY` `USING`/`WITH CHECK`
predicate initially referenced its column schema/table-qualified (e.g.
`tenancy.organizations.status`, `tenancy.organizations.id`). The
three-part dotted form is rejected in both positions — Postgres parses
it as `database.schema.object`, not `schema.table.column` — and for RLS
predicates specifically there's a second, independent reason to avoid
it even where it did parse: the policy expression is evaluated against
whatever alias the calling query gives the table, so a hard-coded
table-qualified reference breaks under aliasing. This affected:

- Both RLS generator functions (`orgScopedCheck`/`currentOrgCheck` in
  `org-scoped-table-policies.ts`/`organizations-policies.ts`).
- The migration file's nine app-role policy predicates, three `CHECK`
  constraints, and two partial-index `WHERE` clauses.
- A **latent instance of the identical issue in the already-committed
  E05-T09 schema**: `sqlInList` (`schema/sql-in-list.ts`) interpolated
  the Drizzle column object directly (`${column}`) into a `sql` template,
  and Drizzle's own serializer renders that fully schema/table-qualified
  in this position — exactly reproducing the same defect the moment
  `drizzle-kit generate` (used as this task's migration-generation aid)
  rendered it into real SQL text.

**Fixed**: every predicate and constraint now references its column bare
(`id`, `organization_id`, `status`, ...); `sqlInList` now renders the
column via `sql.raw(column.name)` instead of interpolating the column
object. A regression test
(`"uses a bare column reference in every USING/WITH CHECK predicate,
never schema/table-qualified"`) was added to both RLS test blocks,
asserting `/\btenancy\.\w+\.\w+/` never matches any generated statement.
Full repo-wide test suite re-run and confirmed green after the fix
(374→377 tests — the 3 new bare-column-reference assertions).

This was not caught by any of the DDL-text tests written before the
review, because those tests checked *shape* (policy names, command
verbs, role scoping) rather than validating the predicate text against
Postgres's actual column-reference grammar. Noted in the design doc's
"Bare column references" section so a future contributor adding a new
policy or CHECK constraint doesn't reintroduce it.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` (via `turbo run build typecheck`)
  — 8/8 tasks pass across all 9 packages.
- `eslint .` — zero findings.
- `pnpm -r test` (via `turbo run test`) — every package passes
  individually. One `@corestack/eslint-config` boundary test
  (`domain may not import Node builtins`) hit the default 5000ms test
  timeout twice under full 9-package CPU contention (it passes in ~1.9s
  standalone) — unrelated to this task's changes, but a real gate defect
  in its own right: 5000ms is too tight for an ESLint fixture's cold-start
  cost under `turbo run test`'s parallelism, and it would keep failing
  for whoever runs the gate next. **Fixed** by raising that one test's
  timeout to 15000ms (`tooling/eslint/test/boundaries.test.mjs`) rather
  than leaving it to fail intermittently.
- Architecture-fitness suite — unchanged at 36 tests across 5 files: no
  new package/manifest surface.
- Export-surface snapshot — unchanged, no regeneration needed: no new
  public exports (the `rls/` module has no package.json export
  condition).

## Permanent policy (Section 11, adopted)

RLS designed before queries; `FORCE RLS` by default; policy names are
part of the migration contract; repository code must not duplicate
policy logic; missing tenant context must fail closed.

## What's still open, not resolved here

- **Anonymous invitation acceptance** — considered (Section 6), not
  implemented. `invitations`' RLS policies stay org-scoped like every
  other table; an unauthenticated acceptance flow needs its own
  session/lookup mechanism, flagged as an explicit open item for
  whichever future task builds it.
- **A user-identity session mechanism** (`app.current_user` or
  equivalent) — deliberately not introduced (ADR-0024); this is what
  blocks "list organizations I belong to" from being served by
  `organizations`' own RLS policy today.
- **Repository adapters, SQL query methods, HTTP handlers** — all
  explicitly out of scope per Section 2/14.
- **A permanent, on-every-schema-change DDL-to-migration generation
  pipeline** — `drizzle-kit generate` was used as a one-time aid this
  task, not wired into the build; the broader tooling question remains
  open, same conclusion `migrations/tenancy/README.md` already reached.
- **Release-pipeline debt** (recurring, tracked across every prior
  report in this sequence): `@corestack/tenancy` remains `0.0.1`, no
  changeset — this task adds no new public exports, so there's nothing
  new for a release train to capture yet. Not a blocker —
  `RELEASE_ENABLED` stays off.

## Next

**E05-T11**: not yet specified by the founder directive sequence. Not
started. Per Section 15, work stops here pending the next prompt — no
repository implementation started automatically.
