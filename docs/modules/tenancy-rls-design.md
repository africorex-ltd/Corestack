# Tenancy Row-Level Security Design (E05-T10)

- **Status:** RLS policy design and migration artifacts only. No
  repository adapter, no SQL query methods, no HTTP handlers — Sections 2
  and 14 of the founder directive that opened this task rule all three
  out explicitly.
- **Scope:** `packages/tenancy/src/infrastructure/postgres/rls/`
  (policy DDL generators + role names),
  `packages/tenancy/src/infrastructure/postgres/ensure-tenancy-postgres-roles.ts`
  (idempotent role/grant bootstrap), and
  `packages/tenancy/migrations/tenancy/0002_create-tenancy-tables.sql`
  (the real migration, generated from the frozen E05-T09 schema and
  hand-authored RLS/GRANT statements).
- **Builds on:** [tenancy-schema-design.md](tenancy-schema-design.md)'s
  "RLS attachment points" section (E05-T09), which froze the column set
  and explicitly left the `organizations` visibility question open for
  this task.
- **Resolves:** [ADR-0024](../adr/0024-tenancy-organizations-rls-direct-visibility.md)
  — `tenancy.organizations` uses direct (id-keyed) visibility, not
  membership-driven or hybrid.

## Policy matrix

| Table | Command | Role | Predicate | Notes |
| --- | --- | --- | --- | --- |
| `organizations` | SELECT | `tenancy_app` | `id = current_setting('app.current_org')::uuid` | Direct visibility (ADR-0024) |
| `organizations` | INSERT | `tenancy_app` | `id = current_setting('app.current_org')::uuid` (WITH CHECK) | Identical predicate to SELECT/UPDATE — see "No special-cased creation bypass" below |
| `organizations` | UPDATE | `tenancy_app` | same (USING + WITH CHECK) | |
| `organizations` | DELETE | — | **no policy, no GRANT** | `Organization.delete()` is a soft-delete `status` UPDATE; no aggregate method issues a physical `DELETE` |
| `organizations` | ALL | `tenancy_platform` | `true` | Cross-organization administration bypass |
| `memberships` | SELECT | `tenancy_app` | `organization_id = current_setting('app.current_org')::uuid` | Standard org-scoped visibility |
| `memberships` | INSERT | `tenancy_app` | same (WITH CHECK) | |
| `memberships` | UPDATE | `tenancy_app` | same (USING + WITH CHECK) | |
| `memberships` | DELETE | — | **no policy, no GRANT** | `Membership.remove()` is a soft-delete `status` UPDATE |
| `memberships` | ALL | `tenancy_platform` | `true` | |
| `invitations` | SELECT | `tenancy_app` | `organization_id = current_setting('app.current_org')::uuid` | Standard org-scoped visibility |
| `invitations` | INSERT | `tenancy_app` | same (WITH CHECK) | |
| `invitations` | UPDATE | `tenancy_app` | same (USING + WITH CHECK) | |
| `invitations` | DELETE | — | **no policy, no GRANT** | Every `Invitation` terminal transition (`accept`/`revoke`/`expire`) is a soft-delete `status` UPDATE |
| `invitations` | ALL | `tenancy_platform` | `true` | |

Every table has `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL
SECURITY` — including for the table owner, matching Section 11's adopted
permanent policy ("FORCE RLS by default"). Policy names are stable and
part of the migration contract (`{table}_select`, `{table}_insert`,
`{table}_update`, `{table}_platform_full_access`) — a future change to a
policy's predicate should keep the same name, not rename-and-recreate,
so `COMMENT ON POLICY` history and any future tooling keyed on these
names stays valid.

**DELETE is never granted or policied for `tenancy_app`, on any of the
three tables.** This is defense in depth, not an oversight: even if a
future change mistakenly `GRANT`s `DELETE`, `FORCE ROW LEVEL SECURITY`
still blocks it because no policy exists for that command. Real physical
deletion (organization purge) is a distinct, not-yet-designed mechanism
this task deliberately does not pre-empt (Section 14).

**`tenancy_platform` is granted `SELECT` only**, on all three tables —
matching `examples/acme-crm-module`'s own precedent exactly. No write or
delete use case exists yet for platform-scoped tenancy access; the
`platform_full_access` policy's `FOR ALL` shape is ready for a future
write use case, but nothing grants the underlying privilege until one is
designed (RLS only restricts an already-permitted operation — the GRANT
still gates whether the operation is attempted at all).

## Visibility model

See [ADR-0024](../adr/0024-tenancy-organizations-rls-direct-visibility.md)
for the full trade-off analysis. Summary: `tenancy.organizations` uses
**direct (id-keyed) visibility** — a session can read/write only the one
organization matching its current tenant context, the same mechanism
every other tenancy table uses. Membership-driven and hybrid visibility
were both rejected because they require a second, currently-nonexistent
session variable identifying *which user* is querying (`app.current_user`
or equivalent) — introducing one would itself violate Section 3's "do
not introduce a new mechanism."

### No special-cased creation bypass

`organizations_insert` uses the identical `id =
current_setting('app.current_org')::uuid` predicate as `SELECT`/`UPDATE`
— there is no "no org yet" bypass for row creation. This works because
`Organization.id` is application-generated via `IdGenerator` *before*
persistence (Architecture rule 2); the future Postgres adapter is
expected to set `app.current_org` from the aggregate's own
`organization.id` (via `PostgresUnitOfWork`'s constructor parameter) for
every `save` call, creation included — not from the calling `Context`.
See "Repository assumptions" below for the full write-path walkthrough.

## Fail-closed behaviour

Every app-role predicate calls `current_setting('app.current_org')`
**without** the `missing_ok` argument. If the session variable was never
set (e.g. a connection pool returned a raw connection outside
`withOrgContext`, or a bug skipped setting it), Postgres raises
`unrecognized configuration parameter "app.current_org"` and the
statement fails outright — loud and closed, never a silent empty result
set or an unscoped read. This is the same fail-closed contract
`buildTenantIsolationDdl` (E03-T30) already established and
`docs/security/tenant-isolation-certification.md` already certified; this
task reuses it rather than inventing a variant.

### A note on the session variable's name

The founder directive's Section 3 names the session variable as
`current_setting('app.current_organization_id')`. Every RLS policy this
task ships instead uses `app.current_org` — the platform's actual, sole,
already-certified tenant-context mechanism
(`packages/platform/src/infrastructure/postgres-org-context.ts`,
`postgres-unit-of-work.ts`, the tenant-isolation certification,
`ARCHITECTURE.md`, `DATABASE.md`, and `examples/acme-crm-module`'s own
migration — `app.current_organization_id` appears nowhere in this
codebase before this task).

Section 3's other clause — "Use the platform RLS mechanism... Do not
introduce a new mechanism" — is unambiguous and already-tested.
Introducing a second, differently-named session variable would itself be
introducing a new, parallel mechanism, contradicting that same sentence.
This design treats the literal variable name as an imprecise gloss, not a
deliberate instruction to change tested production security
infrastructure, and uses `app.current_org` throughout. See
[ADR-0024](../adr/0024-tenancy-organizations-rls-direct-visibility.md)'s
"A note on Section 3's literal wording" for the full reconciliation.
**This is flagged here for founder confirmation, not silently decided:**
if a rename to `app.current_organization_id` is actually wanted across
the platform, that is a distinct, larger task (every other certified
tenant-isolation call site would need to move in lockstep) and should be
requested explicitly rather than assumed from this task's own wording.

### Bare column references, not schema-qualified

Every `CHECK` constraint and every `CREATE POLICY` predicate in the
migration references its column bare (`id`, `organization_id`, `status`,
...), never as `schema.table.column`. A three-part dotted name like
`tenancy.organizations.id` is not a valid table-qualified column
reference inside these expressions — Postgres parses it as
`database.schema.object` and rejects it. RLS predicates are also
evaluated against whatever alias (if any) the calling query gives the
table, so a hard-coded table-qualified name would break under aliasing
even in a context where it happened to parse. The `sqlInList` helper in
the E05-T09 Drizzle schema had the same latent issue (Drizzle's own SQL
serializer renders an interpolated column reference fully qualified in
this position) — fixed as part of this task by rendering the column name
via `sql.raw(column.name)` instead of interpolating the column object
directly.

## Future anonymous invitation acceptance (non-goal)

Section 6 asks this task to "consider the future acceptance flow, but do
not implement anonymous acceptance." `invitations_select` and
`invitations_update` are both scoped to `organization_id =
current_setting('app.current_org')::uuid` — the same as every other
org-scoped policy. This means **an invitee who has not yet joined an
organization, and therefore has no `app.current_org` session context to
scope by, cannot read or accept their own invitation through the
`tenancy_app` role's RLS-scoped path today.**

This is deliberate, not an oversight: an anonymous-acceptance flow (a
token-based, unauthenticated "click this email link to accept" mechanism)
needs its own session/authentication story — most likely a distinct,
narrowly-scoped lookup path (e.g. by invitation token, run as the
platform role or through a dedicated, audited query) rather than a
relaxation of `invitations`' own RLS policy. Designing that path is out
of scope here (Section 6's explicit instruction) and is flagged as a
concrete open item for whichever future task implements the acceptance
HTTP handler, not silently left for that task to discover on its own.

## Future cross-organization administration

Section 4 requires the visibility decision to support "future
cross-organization administration." This is served today by the
`{table}_platform_full_access` policy already present on all three
tables (`FOR ALL`, `USING (true)`, `TO tenancy_platform`) — the same
pattern every other tenancy table has, and the same pattern
`examples/acme-crm-module` already established. No new admin-specific
mechanism was added; Section 14 explicitly rules that out ("do not add
cross-organization admin bypasses yet"), and none was needed since one
already exists generically. A future admin use case runs as the platform
role, the same way relay/sweeper/support tooling already does.

## Repository assumptions

A future Postgres adapter for the three repository ports
(`OrganizationRepository`, `MembershipRepository`,
`InvitationRepository`) can be implemented mechanically against this
design, under these assumptions:

1. **Every write happens inside `PostgresUnitOfWork.run()`**, on a
   connection where `app.current_org` has already been set for that
   transaction (`postgres-org-context.ts`'s `withOrgContext`, or
   equivalent set on the same connection `PostgresUnitOfWork` uses).
2. **For `memberships`/`invitations` writes**, `app.current_org` is set
   from the calling `Context`'s `organizationId` — the standard,
   already-certified pattern every other org-scoped table in this
   codebase uses.
3. **For `organizations` writes — including creation** —
   `app.current_org` must be set from **the aggregate's own
   `organization.id`**, not from `context.organizationId`. This is the
   one place this module's write path differs from the standard
   pattern, and it is a direct consequence of ADR-0024's identical-INSERT-
   predicate decision: without this, a first-time organization creation
   (where no `app.current_org` session context naturally corresponds to
   the not-yet-persisted org) would fail the RLS check and the INSERT
   would be silently rejected as zero rows affected, or blocked outright
   depending on driver behavior.
4. **Reading a single organization safely** (Section 7's explicit ask):
   `OrganizationRepository.findById(context, id)` sets `app.current_org`
   to `id` (the organization being looked up, which for every call site
   today is also the caller's current org) before running a plain
   `SELECT ... WHERE id = $1` — RLS then transparently confirms the
   session is allowed to see that row. If a future call site ever needs
   to look up an organization *other than* the caller's current one
   (there is no such call site today), that read must run as the
   platform role instead, not by loosening this table's app-role policy.
5. **"List organizations the user belongs to"** (an org-switcher UI, for
   example) is **not served by this table's own RLS policy** — see
   ADR-0024's consequences. It requires either the platform role (query
   `memberships` by `user_id`, join to `organizations`) or a future
   user-identity session mechanism this design deliberately does not
   introduce. Flagged, not silently unsupported.
6. **Repository code must not duplicate policy logic.** A repository
   method should never add its own `WHERE organization_id = ...`/`WHERE
   id = ...` tenant-scoping clause defensively — RLS is the single source
   of truth for tenant scoping, per Section 11's adopted permanent
   policy. Duplicating it in query code risks the two drifting apart
   silently; the DDL-consistency test
   (`test/infrastructure/migration-rls-consistency.test.ts`) exists
   precisely so a future *policy* change can't drift from its own
   generator undetected, but nothing catches a *query-level* duplicate
   drifting from the policy except this rule being followed.

## Operational considerations

- **Role bootstrap ordering.** `ensureTenancyModuleRoles` (idempotent —
  delegates to `@corestack/platform`'s `ensureTenancyRoles`) must run
  before the migration: `CREATE POLICY ... TO tenancy_app` fails if the
  role doesn't exist yet. This is the same precondition
  `examples/acme-crm-module`'s own migration already documents.
- **`platform.outbox` access.** `ensureTenancyModuleRoles` also grants
  `USAGE ON SCHEMA platform` and `INSERT ON platform.outbox` to
  `tenancy_app` — without it, every event-publishing `UnitOfWork.run()`
  call in this module would fail with "permission denied for schema
  platform" the moment a future use case stages a domain event, since
  `PostgresUnitOfWork` writes staged events into `platform.outbox` on the
  same connection the module's use case runs on. Same gotcha
  `examples/acme-crm-module`'s own `ensureAcmeCrmRoles` already
  documents.
- **Idempotency.** `CREATE TABLE`/`CREATE INDEX`/`ALTER TABLE ... ADD
  CONSTRAINT` have no `IF NOT EXISTS`-equivalent guard applied in this
  migration, and `CREATE POLICY`/`ALTER TABLE ... ENABLE|FORCE ROW LEVEL
  SECURITY` have no idempotent form in Postgres at all — re-running this
  migration against a database where it already applied would error. The
  migration is idempotent in the sense Section 8 asks for ("where
  practical"): it runs exactly once, gated by the platform migration
  engine's own version tracking (`0002_*`), not by DDL-level
  `IF NOT EXISTS` guards throughout. This is the same posture
  `examples/acme-crm-module`'s migration already takes.
- **No live-database verification in this task.** Every test added here
  (`rls-policies.test.ts`, `migration-rls-consistency.test.ts`) checks
  generated SQL *text*, not behavior against a running Postgres instance
  — per Section 9's explicit "no live database required." The DDL was
  hand-verified against Postgres's documented CHECK-constraint and
  policy-expression column-reference rules (see "Bare column references"
  above), not executed. A future task that stands up a real database
  against this migration is the first point these statements get
  empirically confirmed to execute cleanly.

## Non-goals

- **Repository adapters, SQL query methods, HTTP handlers** — explicitly
  out of scope (Section 2/14).
- **Anonymous invitation acceptance** — considered, not implemented (see
  above); left as an explicit open item for a future task.
- **Cross-organization admin bypasses beyond the existing
  `platform_full_access` pattern** — none added (Section 14).
- **A user-identity session mechanism** (`app.current_user` or
  equivalent) — deliberately not introduced; ADR-0024's "Alternatives
  considered" section covers why, and what capability gap this leaves
  open ("list my organizations").
- **Renaming `app.current_org` to the founder directive's literal
  `app.current_organization_id`** — used the existing, certified name
  instead; flagged above for explicit confirmation rather than assumed.
