# Tenancy migrations

**No tables exist yet.** This directory is a placeholder (E05-T01, Section
6) — the real `organizations`/`memberships`/`invitations` schema ships with
E05-T21 ("Postgres adapter: repositories + migration; RLS on all three
tables").

## Why nothing is here yet

E05-T01's scope is the module scaffold only (`docs/modules/tenancy-
contract.md`; the founder directive that opened this task explicitly says
"do not implement tables yet"). Writing a migration before the
`Organization`/`Membership`/`Invitation` aggregates exist (E05-T02–T04)
would be guessing at a schema before the domain model that constrains it
is settled — schema-first-then-code-later is exactly the ordering
`docs/modules/tenancy-contract.md`'s own "What this document deliberately
does not do" section rules out.

## The known gap this migration will hit: RLS DDL is hand-transcribed today

`buildTenantIsolationDdl()` (`packages/platform/src/domain/tenant-
policy.ts`) already generates the exact `CREATE POLICY` / `ENABLE ROW LEVEL
SECURITY` statements for a given `(schema, appRole, platformRole)` triple.
**Nothing bridges that generator's output into an actual `.sql` migration
file.** Every module that has RLS today — `examples/acme-crm-module`'s own
migration (`migrations/acme-crm/0001_create-contacts.sql`) — hand-writes
the DDL as plain SQL and relies on a human eyeballing it against the
generator's output to confirm the two haven't drifted.

This was flagged as a 🔴 finding in the E05 readiness gate's friction log
(`docs/engineering/e05-readiness-friction-log.md`, step 6) and named
explicitly in the readiness-gate report's GO verdict as "a real decision
Tenancy's own migration (E05-T21) should make deliberately when it's
written — flagged with enough detail in the friction log that it can't be
silently skipped, not something [the readiness gate] should build
speculatively."

Tenancy's migration is exactly where that decision becomes concrete for
the first time outside the golden path: `organizations` is arguably the
tenant-defining table itself (a row *is* an organization, not something
scoped *to* one via `organization_id`), so its RLS policy shape is an open
question `docs/modules/tenancy-contract.md`'s "RLS requirements" section
deliberately leaves for E05-T21 to resolve — a standard `tenant_isolation`/
`platform_full_access` pair, or a membership-join-conditioned policy
instead. `memberships` and `invitations` are unambiguously org-scoped rows
and can follow the acme-crm precedent directly.

## What E05-T21 must do

1. Decide `organizations`' RLS shape (see above) — write the decision down,
   don't default to the acme-crm pattern by inertia.
2. For all three tables, either continue the hand-transcription-plus-
   review convention (acceptable, but the drift risk stays real and
   manual) or build the DDL-to-migration bridge this gap has been flagging
   since the readiness gate — that bridge decision itself is scoped to
   E05-T21, not pre-empted here.
3. Follow the existing migration-file contract (`packages/platform/src/
   domain/migration-file.ts`): a `@description`/`@lock-impact` header,
   sequential versioning starting at `0001_*.sql`, validated by
   `loadMigrationSet`.
