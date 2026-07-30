# ADR 0025: `PostgresOrganizationRepository.save` sets its own `app.current_org`, not `PostgresUnitOfWork`'s constructor

- **Status:** Accepted
- **Date:** 2026-07-30
- **Supersedes (partially):** a specific claim in [ADR-0024](0024-tenancy-organizations-rls-direct-visibility.md)'s "Decision" section — everything else in ADR-0024 (direct/id-keyed visibility, the identical-predicate-for-INSERT reasoning) stands unchanged.

## Context

ADR-0024 states: "the future Postgres adapter is expected to set
`app.current_org` from the aggregate's own `organization.id` (via
`PostgresUnitOfWork`'s constructor parameter) for every `save` call,
creation included." Building `PostgresOrganizationRepository` (E05-T11)
against this literally is impossible for organization **creation**:
`PostgresUnitOfWork`'s constructor
(`packages/platform/src/infrastructure/postgres-unit-of-work.ts`) takes
`organizationId` as a plain constructor argument, set once, before
`.run()` is even called — but `createOrganization`'s own code generates
the new organization's id **inside** the `uow.run()` callback
(`Organization.create({ id: deps.ids.generate(), ... })`), after the
`UnitOfWork` object already exists. There is no way for the constructor
to have been given an id that doesn't exist yet.

## Decision

**`PostgresOrganizationRepository.save(tx, context, organization)` issues
its own `SELECT set_config('app.current_org', $1, true)` as the first
statement of its own SQL, using `organization.id` (the aggregate's own
id, always known by the time `save` is called) — on the same
already-open transaction (`tx.sql`), not a new one.** This is not
"creating an independent transaction inside a repository" (Section 3's
prohibition) — `set_config(..., true)` is a session-variable assignment
scoped to the transaction already in progress, the identical mechanism
`PostgresUnitOfWork`'s own constructor path and `withOrgContext` already
use, just issued from a different call site.

This makes `save` self-sufficient regardless of what (if anything) the
enclosing `PostgresUnitOfWork` set `app.current_org` to at transaction
start:

- **Creation**: the enclosing `PostgresUnitOfWork` is constructed with
  `organizationId: null` (there is no organization yet when
  `createOrganization`'s `deps.uow` is wired) — `app.current_org` is
  unset until `save` sets it itself, immediately before its `INSERT`.
- **Update** (a future `renameOrganization`/`suspendOrganization`/etc.
  use case): `save` re-sets `app.current_org` to the same value
  `context.organizationId` already equals — redundant but harmless, and
  it means `save` never has to know or care which case it's in.

## Consequences

- `existsBySlug`/`findBySlug` (also pre-org-scope, called before
  `organization.id` exists at all for creation) **cannot** rely on this
  same trick — there is no aggregate id yet to scope by. These two
  methods use a different mechanism entirely: a deliberate, narrow
  elevation to the `tenancy_platform` role for the single read (see
  `docs/modules/tenancy-postgres-adapters.md`'s "RLS assumptions"), not
  covered by this ADR.
- `ensureTenancyModuleRoles` grants `tenancy_platform` to `tenancy_app`
  **`WITH INHERIT FALSE`** to make that elevation possible without
  permanently disabling tenant isolation for the app role — verified
  empirically that an inheriting grant (`WITH INHERIT TRUE`, the PG16+
  default) makes RLS silently apply the union of every role a session
  belongs to, cross-tenant, all the time, not just when explicitly
  elevated. This is a separate, additional finding beyond what this ADR
  is about, recorded here because it was discovered in the same
  investigation; see the role-bootstrap file's own doc comment for the
  full empirical detail.
- Every other repository (`memberships`, `invitations`) is unaffected —
  neither needs this pattern, since both are org-scoped by
  `organization_id` and the enclosing `UnitOfWork`'s own
  `context.organizationId`-derived `app.current_org` is always
  sufficient for their entire lifetime, reads and writes alike.
