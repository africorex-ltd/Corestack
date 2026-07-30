# E05-T09 — Tenancy Postgres Schema Design: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T09 only. Do not implement
  repository adapters, SQL queries, RLS policies, or HTTP handlers."
  Sections 1–17.
- **Verdict:** **Complete**, schema design only, exactly as scoped.

## What shipped

In `packages/tenancy/src/infrastructure/postgres/schema/` (new, internal
— no `./postgres` package export yet):

| File | Contents |
| --- | --- |
| `tenancy-pg-schema.ts` | `tenancySchema = pgSchema("tenancy")` |
| `sql-in-list.ts` | `sqlInList` — shared `column IN (...)` SQL-text builder for CHECK constraints and partial-index `WHERE` predicates |
| `organizations.ts` | `organizations` table |
| `memberships.ts` | `memberships` table |
| `invitations.ts` | `invitations` table |
| `index.ts` | Barrel (internal) |

`drizzle-orm` added as an optional peer + dev dependency
(`packages/tenancy/package.json`), mirroring the `postgres`-driver
pattern already established in `@corestack/platform`'s `package.json` —
this is the "first module repository adapter" moment
[ADR-0017](../adr/0017-drizzle-deferred-to-first-module-repository.md)
deferred Drizzle's introduction to.

Full design writeup:
[docs/modules/tenancy-schema-design.md](../modules/tenancy-schema-design.md)
(ER diagram, index/partial-index rationale, deletion strategy,
membership/invitation uniqueness strategy, repository persistence
expectations, RLS attachment points, non-goals) and
[docs/modules/tenancy-persistence-mapping.md](../modules/tenancy-persistence-mapping.md)
(field-by-field aggregate→row mapping).

**Tests:** 1 new test file, 23 new tests
(`test/infrastructure/schema.test.ts`, no live database —
`drizzle-orm/pg-core`'s `getTableConfig` introspection only): schema
builds under the `tenancy` Postgres schema; column not-null/primary-key
shape matches Section 4/5/6's field lists; enum values match the
matching domain enum exactly; unique/partial-unique indexes and foreign
keys exist with the right column lists and `onDelete` behavior; no
`token_hash` column on `invitations`; and — added after a self-review
pass, see below — no bind-parameter placeholder appears anywhere inside
any `CHECK`/partial-index `WHERE` expression tree (tenancy package:
307→330 total, 21→22 files).

## ADR-0023: enums are CHECK-constrained `text`, not native `ENUM`

Section 7 asks to "create database enums matching the current domain
model" — read literally, this points at Drizzle's `pgEnum` (native
Postgres `CREATE TYPE ... AS ENUM`). `docs/architecture/DATABASE.md` §1
rule 5 already settled this differently, before this task existed:
"Status/enum columns are `text` + `CHECK` constraint, not native
Postgres enums... adding a value to a native enum is easy, but
removing/renaming is painful and lock-prone." `OrganizationStatus` is a
specific, already-flagged case of an enum whose value set is expected to
change (the still-open 3-state vs 4-state reconciliation) — exactly the
scenario rule 5's rationale describes.

**Decision, written up as
[ADR-0023](../adr/0023-tenancy-schema-text-enum-with-check-constraint.md):**
every enum-shaped column uses Drizzle's `text(column, { enum: [...] })`
— plain `text` at the database level, a TypeScript literal union at the
application level — plus an explicit `CHECK` constraint enumerating the
same values. Each value list is sourced directly from the matching
domain constant object (`OrganizationStatus`, `MembershipRole`, etc.),
not re-typed independently, so a renamed domain value is a compile
error in the schema file.

## A finding from self-review, fixed before commit

Two issues surfaced by re-reading the work critically before finalizing,
not by any tool failure:

1. **`created_at`/`joined_at` originally carried `.defaultNow()`** as "an
   inert safety net" per DATABASE.md §1 rule 6's general guidance. On
   review, this was a real footgun, not a safety net: every aggregate
   always supplies its own creation instant, and that instant must equal
   the same value already published on the aggregate's own creation
   event. A DB-side default makes the column *optional* in Drizzle's
   insert type — a future insert path that omitted it wouldn't get a
   type error, just a row whose `created_at`/`joined_at` silently
   disagreed with its own event's `occurredAt`. **Fixed**: removed
   `.defaultNow()` from all three creation-timestamp columns
   (`organizations.created_at`, `memberships.joined_at`,
   `invitations.created_at`), matching the same "the application
   supplies everything" discipline ids already follow (no
   `.defaultRandom()`). Documented explicitly in both design docs as a
   deliberate deviation from DATABASE.md's general rule.
2. **The schema tests initially only asserted a `CHECK`/partial-index
   existed by name**, never that its SQL actually renders as valid DDL.
   Since `CHECK` constraints and partial-index `WHERE` clauses can never
   contain a bind parameter (they're DDL, not a query) — and the whole
   ADR-0023 claim depends on that being true — this was a real gap.
   **Fixed**: added a recursive `assertNoBindParameters` helper to the
   test file, walking every `CHECK`/`WHERE` expression's `queryChunks`
   tree and failing if a `Param` node ever appears; empirically verified
   via a direct build + `getTableConfig` inspection first (confirming
   the rendered chunk is a literal `StringChunk` — `'ACTIVE',
   'SUSPENDED', 'DELETED'` — never a bind placeholder) before writing
   the assertion.

Also corrected during the same pass: the index-rationale table originally
credited the plain `memberships_org_user_idx` with backing `existsActive`
— it actually backs `findByUserId` (all statuses); `existsActive`'s
query shape matches the partial unique index exactly instead. Fixed in
both the schema file's comment and the design doc's table.

## Membership and invitation uniqueness strategy — judgment calls made explicit

Both partial unique indexes required a scope decision the founder
directive's wording alone didn't fully resolve:

- **`memberships_active_org_user_key`** is scoped to `status = 'ACTIVE'`
  only, not `IN ('ACTIVE', 'SUSPENDED')`. A `SUSPENDED` membership isn't
  currently reachable by any path that would also try to create a second
  row for the same user, so the tighter scope is sufficient today and
  matches Section 5's literal "one **active** membership" wording. Flagged
  in the design doc as the first thing to revisit if a future task
  introduces a path that could collide with a merely-suspended row.
- **`invitations_pending_org_email_key`** is scoped to `status =
  'PENDING'` — unambiguous here, since `ACCEPTED`/`REVOKED`/`EXPIRED` are
  all terminal and history rows must remain queryable without ever
  colliding with a new invitation to the same address. This matches
  DATABASE.md §5's own blueprint design exactly.

## `organizations`' plain (non-partial) `UNIQUE(slug)`

Unlike DATABASE.md §5's blueprint (`PUX slug WHERE status <> 'purged'`),
the implemented 3-state `Organization` model has no `purged` state to key
a partial index off of — a `DELETED` organization's slug stays taken
today. A plain `UNIQUE(slug)` is therefore the correct schema for the
model as actually built, not an oversight; the design doc flags exactly
what changes (`organizations_slug_key` becomes a partial index scoped to
`WHERE status <> 'PURGED'`) if/when the 3-state vs 4-state reconciliation
lands.

## RLS attachment points (Section 11) — one mechanism, one open question

`@corestack/platform` already ships everything a future RLS task needs:
`buildTenantIsolationDdl` (E03-T30) generates the standard
`organization_id = current_setting('app.current_org')::uuid` policy DDL
for any table. `memberships`/`invitations` attach it with zero new
design work. `organizations` is the one genuinely open question —
already flagged by `OrganizationRepository`'s own port doc before this
task started: a row here *is* an organization, not something scoped *to*
one, so the standard policy shape doesn't apply verbatim. The design doc
lays out both candidate shapes (`id`-keyed vs. a membership-join
condition) without choosing between them — that decision belongs to the
next task, not this one.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` — all pass; tenancy typechecked
  clean on the first attempt, both before and after the self-review
  fixes above.
- `eslint .` — zero findings.
- `pnpm -r test` — 695 tests across 64 files in the unit/application
  lanes (tenancy alone: 330, up from 307), plus platform's unchanged 97
  integration tests and acme-crm's unchanged 4.
- Architecture-fitness suite — unchanged at 36 tests across 5 files: no
  new package/manifest surface, and the new `infrastructure/postgres/`
  files don't match any repository/adapter-scanning fitness rule.
- Export-surface snapshot — **unchanged**, no regeneration needed; the
  schema module has no package.json export condition yet.
- `pnpm install --frozen-lockfile` — confirmed the lockfile update for
  the new `drizzle-orm` dependency is internally consistent.

## Permanent policy (Section 14, adopted)

Schema before adapters; partial indexes for state-dependent uniqueness;
value objects map explicitly to columns; RLS planned at schema time
(attachment points documented, policies not yet written); no
ORM-driven implicit constraints (every enum enforced by an explicit
`CHECK`, not left to Drizzle's TypeScript-only `{ enum: [...] }` typing
alone).

## What's still open, not resolved here

- **The `organizations` RLS policy shape** — explicitly the next RLS
  task's decision (Section 11).
- **A `version`/optimistic-concurrency column** — not present on any
  aggregate today; documented as an open concurrency-expectations gap.
- **The 3-state vs 4-state `Organization` status reconciliation** — used
  the implemented (3-state) model throughout, per Section 7's explicit
  instruction; `organizations_slug_key`'s eventual migration to a partial
  index is flagged in advance.
- **Repository adapters, SQL queries, RLS policies, migrations beyond
  these schema definitions, HTTP handlers** — all explicitly out of
  scope per Section 2/16.
- **Release-pipeline debt** (recurring, tracked across every prior
  report in this sequence): `@corestack/tenancy` remains `0.0.1`, no
  changeset — but like E05-T08, this task adds no new public exports,
  so there's nothing new for a release train to capture yet. Not a
  blocker — `RELEASE_ENABLED` stays off.

## Next

**E05-T10**: not yet specified by the founder directive sequence. Not
started. Per Section 17, work stops here pending the next prompt — no
repository implementation or RLS policies started automatically.
