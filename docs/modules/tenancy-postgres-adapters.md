# Tenancy Postgres Repository Adapters (E05-T11)

- **Status:** real Postgres persistence for all three repository ports.
  No HTTP handlers, no background jobs, no anonymous invitation
  acceptance, no cross-organization admin features (explicitly out of
  scope per Sections 1/14).
- **Scope:** `packages/tenancy/src/infrastructure/postgres/postgres-
  organization-repository.ts`/`postgres-membership-repository.ts`/
  `postgres-invitation-repository.ts`, their mappers
  (`infrastructure/postgres/mappers/`), constraint-violation translation
  (`infrastructure/postgres/constraint-violation.ts`), and the package's
  new `./postgres` subpath export (`src/postgres/index.ts`).
- **Builds on:** [tenancy-rls-design.md](tenancy-rls-design.md) (E05-T10)
  and [ADR-0024](../adr/0024-tenancy-organizations-rls-direct-visibility.md).
- **Introduces:** [ADR-0025](../adr/0025-organization-save-sets-own-org-context.md)
  (corrects a specific claim in ADR-0024 about how `app.current_org` gets
  set for organization creation).

## Transaction boundaries

**Every repository port method now takes `tx: TransactionContext` as its
first parameter** — the generic kernel type (`{ publish }`), not a
Postgres-specific one, so the ports (`OrganizationRepository`/
`MembershipRepository`/`InvitationRepository`) stay infrastructure-
agnostic. This was a necessary, non-optional signature change: every
real call site is inside a `UnitOfWork.run()` callback, and
`docs/unit-of-work.md`'s own "Transaction ownership" rule is unambiguous
— *"Inside a `UnitOfWork.run()` callback: use `ctx.sql` for repository
queries. Do not call `withOrgContext`/`runOrgScopedQuery` here — they
would try to open a second transaction on the same connection pool."*
Since every method on all three tenancy use cases (`createOrganization`/
`inviteMember`/`acceptInvitation`) runs entirely inside one
`uow.run(async (tx) => {...})` call, every repository call inside them
needed a way to reach that same open transaction. `PostgresOrganizationRepository`/
`PostgresMembershipRepository`/`PostgresInvitationRepository` narrow `tx`
to `PostgresTransactionContext` internally (`(tx as
PostgresTransactionContext).sql`) to reach `.sql` — the same "additive
on the concrete adapter only" pattern `PostgresTransactionContext` itself
was built on. The in-memory reference repositories ignore the parameter
entirely.

This mirrors `examples/acme-crm-module`'s own
`ContactRepository.create(tx: TransactionSql, ...)` precedent, adapted
one level up: acme-crm's port is directly Postgres-coupled (`import type
{ TransactionSql } from "postgres"` in its own application-layer file,
acceptable there since it has no in-memory counterpart to keep decoupled
from); Tenancy already has three real in-memory repositories the
workflow harness and every unit test depend on, so the port itself had
to stay adapter-agnostic.

**No repository method opens its own transaction** (Section 3) — with
one narrow, deliberate exception: `existsBySlug`/`findBySlug` briefly
elevate the *role* (not the transaction) mid-call, covered under "RLS
assumptions" below.

## Mapper strategy

Dedicated files, one per table, each exporting a pair of pure functions
(`infrastructure/postgres/mappers/{organization,membership,invitation}-
mapper.ts`):

- `to{X}(row): {X}` — row → aggregate, via a new `{X}.reconstitute(...)`
  static factory added to each aggregate this task (`Organization`/
  `Membership`/`Invitation`). This was a required, minimal domain-layer
  addition: the only pre-existing public factory, `static create(...)`,
  always forces initial state (`ACTIVE`/no terminal timestamps) and
  always emits a domain event — wrong on both counts for loading an
  *existing* row, which is not a new business fact. `reconstitute`
  bypasses both: it takes the full persisted state as plain values,
  calls the aggregate's private constructor directly, and emits no
  event. It does not re-validate creation-time invariants (e.g. name
  length, `expiresAt` strictly after `now`) — a persisted row is trusted
  to already satisfy whatever invariants applied when it was written.
- `to{X}Row(aggregate): {X}RowValues` — aggregate → row, the exact
  inverse, producing plain values a repository's `INSERT`/`UPDATE`
  statement consumes directly.

No repository method inlines field-by-field mapping (Section 7's
explicit instruction) — every `findById`/`save` goes through these
functions. Enum columns (`status`/`role`) are trusted as their domain
enum type without re-validation on the row → aggregate direction,
because the corresponding `CHECK` constraint (E05-T09) already
guarantees a legal value; there is no scenario where a row's `status`
column holds something `OrganizationStatus`/`MembershipStatus`/etc.
doesn't recognize.

## RLS assumptions

- **`memberships`/`invitations`**: every method relies entirely on RLS
  for organization scoping — no method adds its own `WHERE
  organization_id = ...` clause (Section 11/12's permanent policy: "RLS
  is the isolation boundary"; "repository code must not duplicate policy
  logic"). `app.current_org` is already set for the whole transaction by
  the enclosing `PostgresUnitOfWork`, constructed with
  `context.organizationId` — no platform-role elevation anywhere in
  either repository.
- **`organizations`**: `findById`/`listForContext` work the same way
  (org-scoped, no elevation) — but `existsBySlug`/`findBySlug`/`save`
  are pre-org-scope (`Context`, not `OrgScopedContext`) and hit two
  distinct RLS consequences, both discovered empirically while building
  this task, not assumed:

  1. **`existsBySlug`/`findBySlug` need to see across every
     organization**, but ADR-0024's own policy restricts the app role to
     `id = current_setting('app.current_org')::uuid` — structurally
     blind to any other organization's row. Confirmed empirically
     (`SELECT ... WHERE slug = $1` under the app role with no
     `app.current_org` set throws `42704 unrecognized configuration
     parameter`, not an empty result) that this is a hard block, not a
     performance nuance. **Resolution**: both methods issue `SET LOCAL
     ROLE tenancy_platform` on the already-open transaction immediately
     before their one query, then `RESET ROLE` immediately after —
     `tenancy_platform`'s `{table}_platform_full_access` policy
     (`USING (true)`) needs no `app.current_org` at all. This required
     one bootstrap addition: `ensureTenancyModuleRoles` now grants
     `GRANT tenancy_platform TO tenancy_app WITH INHERIT FALSE`.
     **`WITH INHERIT FALSE` is load-bearing**: confirmed empirically that
     a plain (`WITH INHERIT TRUE`, the PG16+ default) grant makes every
     one of `tenancy_app`'s RLS-scoped queries *silently* also satisfy
     `tenancy_platform`'s policy, permanently disabling tenant isolation
     for the app role — Postgres evaluates RLS against the union of
     every role a session belongs to when membership inherits.
     `INHERIT FALSE` requires the explicit `SET LOCAL ROLE` to activate
     the grant at all; confirmed that without the grant entirely,
     `SET LOCAL ROLE` itself fails with `42501 permission denied to set
     role`.
  2. **`existsBySlug`/`findBySlug` are still not a hard cross-tenant
     guarantee for anything beyond visibility** — they answer "can the
     platform role see a row with this slug," which is always accurate,
     but the *real* enforcement of slug uniqueness is
     `organizations_slug_key` (the unique constraint) plus `save`'s own
     constraint-violation translation (below). `existsBySlug` remains,
     as documented since E05-T03, a best-effort pre-check.

  3. **`save` cannot rely on `PostgresUnitOfWork`'s constructor to set
     `app.current_org`** for organization creation, because the
     aggregate's id doesn't exist until partway through the enclosing
     use case's callback — see ADR-0025. `save` instead issues `SELECT
     set_config('app.current_org', $1, true)` itself, using
     `organization.id`, as its first statement, inside the same already-
     open transaction. This makes `save` self-sufficient regardless of
     what (if anything) the enclosing `PostgresUnitOfWork` set
     `app.current_org` to.
  4. **The `finally { RESET ROLE }` failure mode, considered and not
     mitigated further**: if `RESET ROLE` itself were to throw (e.g. the
     connection drops mid-call), the transaction would in principle be
     left with an elevated role for whatever runs next. In practice this
     is not exploitable: Postgres marks a transaction as aborted after
     any error occurring inside it, so every subsequent statement
     (including `save`'s `INSERT`) fails with `25P02 current transaction
     is aborted` rather than silently running with `tenancy_platform`'s
     `USING (true)` visibility. `RESET ROLE` failing without the
     connection itself failing is not a case `postgres.js` can produce —
     there is no server-side precondition that makes `RESET ROLE` fail
     while the session is otherwise healthy. Not re-verified with its
     own spike (the two facts above follow directly from documented
     Postgres transaction-error semantics), so treat this paragraph as
     reasoned, not empirically confirmed like the three facts above it.

- **Deliberately no findByOrganizationAndUser method** (Section 5,
  despite the founder directive's wording) — `MembershipRepository.
  findByUserId(tx, context, userId)` already *is* this operation, since
  `context.organizationId` supplies the organization half; T08 already
  declined to duplicate it and nothing since has changed.
- **`findBySlug` added per Section 4's explicit ask, with no current
  caller** — `createOrganization` uses `existsBySlug`, not `findBySlug`.
  Flagged here so a future reader doesn't mistake it for a discovered
  requirement; implemented because the directive named it explicitly and
  it was mechanical to add (same elevation as `existsBySlug`).

## Constraint translation (Section 8)

`infrastructure/postgres/constraint-violation.ts` exposes
`isUniqueViolation(error)`/`uniqueViolationConstraintName(error)`, built
against SQLSTATE `23505` and `error.constraint_name` — both confirmed
empirically against a real PostgreSQL 18.4 instance before writing any
translation code (not guessed): a duplicate-key `INSERT` surfaces
`error.code === "23505"` and `error.constraint_name` as plain string
properties on the thrown `postgres.js` error, alongside `table_name`/
`schema_name`/`detail`.

Each repository's `save()` catches its own `INSERT ... ON CONFLICT (id)
DO UPDATE` call and switches on the constraint name:

| Table | Constraint | Domain error |
| --- | --- | --- |
| `organizations` | `organizations_slug_key` | `DuplicateSlugError` |
| `memberships` | `memberships_active_org_user_key` | `MembershipAlreadyExistsError` |
| `invitations` | `invitations_pending_org_email_key` | `InvitationAlreadyExistsError` |

All three use cases (`createOrganization`/`inviteMember`/
`acceptInvitation`) now wrap their `save()` call in a `try`/`catch` that
converts exactly this already-declared error type into `Err(...)` — no
use case's `Result` error union changed, since every one of these three
errors was already a declared possible outcome (from the existing
best-effort `exists*` check). This is what makes the constraint
translation load-bearing rather than cosmetic: without it, a genuine
race (both callers pass the best-effort check, one loses at the
database) would surface as an unhandled promise rejection instead of a
graceful `Result.err(...)`.

**Known remaining leak point** (Section 8's explicit ask to document
this): every other Postgres error — connection failures, foreign-key
violations (`23503`), the RLS fail-closed errors themselves (`42704`,
`42501`), syntax errors — is **not** caught anywhere in these
repositories and propagates as a raw `postgres.js` error out of every
method. Only the three specific, already-modeled unique-violation cases
above are translated; anything else is a genuinely unexpected failure a
caller should not silently swallow.

## Operational considerations

- **Role bootstrap ordering unchanged from E05-T10**: `ensureTenancyModuleRoles`
  must still run before the migration (roles must exist before `CREATE
  POLICY ... TO tenancy_app` can reference them). The one addition,
  `GRANT tenancy_platform TO tenancy_app WITH INHERIT FALSE`, is
  idempotent — Postgres updates an existing membership's `INHERIT` flag
  on a repeat `GRANT`, it does not error.
- **Real per-role credentials remain out of scope**, same residual risk
  `docs/security/tenant-isolation-certification.md` already tracks (R3):
  this task's integration tests grant a temporary login password to
  `tenancy_app` scoped to a disposable per-test scratch database, the
  same test-only pattern E03-T31/`examples/acme-crm-module` already
  established. A real deployment's connection-authentication strategy is
  not decided here.
- **`existsBySlug`/`findBySlug`'s role elevation requires the grant
  above** to exist in whatever database the connecting `tenancy_app`
  role actually is — if a deployment's bootstrap ever skips
  `ensureTenancyModuleRoles` (or an older version without this grant),
  both methods fail loudly (`42501 permission denied to set role`)
  rather than silently returning wrong answers — fail-closed, consistent
  with every other RLS failure mode this module already has.
- **Migration/role bootstrap is the harness's own responsibility in
  tests**: `packages/tenancy` had no integration-test infrastructure
  before this task (its `vitest.config.ts`, from E05-T01, excluded
  `test/integration/**` from every Vitest invocation, including
  `test/integration` itself, when passed as a CLI path filter — Vitest's
  `--exclude` flag adds to a config file's `exclude` list rather than
  replacing it). Fixed with a dedicated `vitest.integration.config.ts`
  (no exclude of `test/integration/**`, since it *only* includes that
  directory) and `test:integration`'s script updated to use `--config`
  instead of a bare path filter. This is a real, previously-undiscovered
  defect in E05-T01's own config, not something this task introduced —
  it simply never had an integration test to expose it before now.

## Known limitations

- **`findByUserId`'s "current membership" semantics are best-effort**
  when more than one row exists for the same user in the same
  organization (the schema permits this — only `ACTIVE` uniqueness is
  enforced). The Postgres adapter orders by `updated_at DESC LIMIT 1`;
  the in-memory reference's own "last `save` wins" simplification is the
  same idea for the common single-row case. Neither is a real design
  decision about what "current" should mean long-term — flagged, not
  silently assumed correct.
- **No query services beyond the existing repository ports** — per
  Section 2, nothing here builds a read-model, a list/search endpoint,
  or any query shape beyond what `OrganizationRepository`/
  `MembershipRepository`/`InvitationRepository` already declared.
- **No HTTP handlers, background jobs, anonymous invitation acceptance,
  or cross-organization admin features** — all explicitly out of scope
  (Section 1/14); the repositories are ready for a future task to wire
  into use cases exposed over HTTP, but nothing here does that wiring.
- **A permanent, on-every-schema-change DDL generation pipeline remains
  unbuilt** — unrelated to this task specifically (E05-T10's own
  unresolved item), noted again here since the migration these adapters
  query against is the same one that gap applies to.
