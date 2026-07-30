# Tenancy Query Services (E05-T12)

- **Status:** the tenancy module's complete read side — `GetOrganizationQuery`,
  `ListOrganizationMembersQuery`, `ListPendingInvitationsQuery`. No HTTP
  handlers, no background jobs, no anonymous invitation acceptance, no
  cross-organization admin features (explicitly out of scope per
  Sections 1/14 of the founder directive).
- **Scope:** `packages/tenancy/src/application/get-organization-query.ts`,
  `list-organization-members-query.ts`, `list-pending-invitations-query.ts`
  — each file bundles its DTO, its aggregate-to-DTO mapper, and its query
  function, mirroring how `create-organization.ts` already bundles
  `CreateOrganizationResult` alongside `createOrganization` (Section 7:
  "use dedicated query classes/services").
- **Builds on:** [tenancy-postgres-adapters.md](tenancy-postgres-adapters.md)
  (E05-T11) — every query runs its repository call through the same
  `PostgresOrganizationRepository`/`PostgresMembershipRepository`/
  `PostgresInvitationRepository` adapters, unchanged. **No new repository
  method was added for this task** (Section 2) — all three queries are
  built entirely on `findById`/`listForOrganization`, which already
  existed.

## Query boundaries

Section 3's four rules, applied literally, are the entire design:

- **Tenant-scoped.** Every query takes an `OrgScopedContext`
  (`@corestack/platform`), the same narrowed type every write-side use
  case already requires — there is no tenancy query that runs
  unscoped.
- **Rely on RLS.** No query adds its own `WHERE organization_id = ...`
  filter, and none needs to: `listForOrganization` is already fully
  scoped by the enclosing transaction's `app.current_org` (E05-T10/T11),
  and `findById`'s visibility is likewise entirely a function of RLS, not
  of anything this task adds.
- **Return DTOs, not aggregates.** `getOrganization` returns
  `OrganizationSummary | null`; `listOrganizationMembers` returns
  `readonly OrganizationMemberSummary[]`; `listPendingInvitations` returns
  `readonly PendingInvitationSummary[]`. None of the three ever hands a
  caller an `Organization`/`Membership`/`Invitation` instance.
- **No side effects, no authorization beyond tenant scope.** None of the
  three publishes an event (contrast every write-side use case, which
  always does) — `deps.uow.run()` still opens and commits a real
  transaction (there is no read-only variant of `UnitOfWork` — see
  "Why these still run inside a `UnitOfWork`" below), but nothing is ever
  staged on `tx.publish`, so the commit is a no-op from an event
  standpoint. No query inspects `context.actor` or any role/permission
  concept — "can this actor see this data" is entirely RLS's question,
  never this layer's.

### Why these still run inside a `UnitOfWork`

A query has no domain-level need for a transaction — it writes nothing.
But `docs/unit-of-work.md`'s "Transaction ownership" rule leaves no
other sanctioned way to obtain a `TransactionContext`/`tx.sql` to hand to
a repository method: repository ports take `tx: TransactionContext` as
their first parameter (E05-T11), and every real value of that type comes
from inside a `UnitOfWork.run()` callback. Each query's `deps.uow.run(async
(tx) => {...})` call exists purely to reach that `tx`, not because the
query has any writes to atomically group. This mirrors the write-side use
cases' own shape (`deps: { uow, repository, ... }`) rather than inventing
a separate "query context" concept — Section 11's permanent policy
("query shape owned by the application layer") is satisfied by keeping
queries structurally uniform with commands, not by giving them a
different plumbing mechanism.

## DTO rationale

Three DTOs, one per query, each named `*Summary` (not `*Dto` or
`*ReadModel` — no such suffix convention exists elsewhere in this
codebase, so none was invented here):

| DTO | Fields | Source aggregate |
|---|---|---|
| `OrganizationSummary` | `id`, `slug`, `name`, `status`, `createdAt`, `updatedAt` | `Organization` |
| `OrganizationMemberSummary` | `id`, `userId`, `role`, `status`, `joinedAt` | `Membership` |
| `PendingInvitationSummary` | `id`, `email`, `role`, `invitedBy`, `createdAt`, `expiresAt` | `Invitation` |

Every field list is exactly the founder directive's own field list
(Sections 4/5/6) — no extra field was added "since it's already on the
aggregate." Two deliberate omissions, both directive-specified rather
than a design judgment call:

- **`OrganizationSummary` excludes `deletedAt`.** `Organization` itself
  has a `deletedAt` getter (`null` unless `status` is `DELETED`); Section
  4's field list stops at `updatedAt`. A caller can already tell a
  `DELETED` organization apart via `status` — `deletedAt`'s exact instant
  is not exposed.
- **`OrganizationMemberSummary` excludes `removedAt`** (Section 5: "Do
  not expose removedAt"), for the identical reason: `status` alone
  already communicates `REMOVED`. Notably, **`ListOrganizationMembersQuery`
  does not filter out `REMOVED` memberships** — Section 5 asks only that
  the field be hidden, not that removed members be excluded from the
  list. Every membership in the organization comes back, regardless of
  status, sorted by `joinedAt`.
- **`PendingInvitationSummary` has no `status` field at all.** Unlike the
  other two DTOs, every row this query returns is `PENDING` by
  construction (filtered before mapping) — a constant field would be
  noise, not information.

Each mapper (`toOrganizationSummary`, `toOrganizationMemberSummary`,
`toPendingInvitationSummary`) is a small, explicit, hand-written function
from an aggregate instance to a plain object — never a reused aggregate
reference, never a generic/reflective mapper. This is "row-to-DTO"
loosely applied (Section 7's literal phrase): no new repository method
exists that returns a raw database row to a query, since Section 2
forbids adding one, so every query necessarily goes through the same
aggregate-returning methods (`findById`/`listForOrganization`) the
write-side use cases already use, then maps the resulting aggregate to a
DTO. "Return DTOs, not aggregates" (Section 3) is enforced at the
query's *return type*, not by bypassing the domain layer for reads.

## RLS assumptions

Identical to [tenancy-postgres-adapters.md](tenancy-postgres-adapters.md)'s
own "RLS assumptions" section — nothing new was introduced for queries,
which is the point: the read side inherits the write side's isolation
guarantees for free, because it calls the exact same repository methods.

- **`listOrganizationMembers`/`listPendingInvitations`** rely entirely on
  `listForOrganization`'s existing RLS scoping (`app.current_org`,
  already set by the enclosing `UnitOfWork` from `context.organizationId`)
  — no platform-role elevation, same as `MembershipRepository`/
  `InvitationRepository` always have.
- **`getOrganization`** relies on `findById`'s existing RLS scoping. Its
  signature deliberately mirrors `findById`'s own shape — `context:
  OrgScopedContext` **and** a separate `organizationId` parameter, rather
  than always reading `context.organizationId` — because the explicit
  `organizationId` is "what the caller is asking for" (e.g., a future
  HTTP handler's path parameter), which is not itself trustworthy input.
  If `organizationId` names a different organization than the one
  `context`/the enclosing transaction is scoped to, RLS intersects the
  query's `WHERE id = $1` with the `organizations_select` policy's
  `id = current_setting('app.current_org')::uuid` predicate and returns
  zero rows — `getOrganization` sees this as an ordinary `null`, exactly
  as if the row didn't exist. This is the query-layer proof of Section
  8's "organization A cannot see organization B," reusing the identical
  mechanism `PostgresOrganizationRepository`'s own T11 integration test
  already proved at the repository layer.
- **Elevated uniqueness checks do not affect query visibility** (Section
  8's fourth verification point). `existsBySlug`/`findBySlug` elevate to
  `tenancy_platform` (`SET LOCAL ROLE`, `WITH INHERIT FALSE` — see
  tenancy-postgres-adapters.md) for their one query each, then `RESET
  ROLE` immediately after, inside the same transaction. A new integration
  test (`test/integration/tenancy-postgres.postgres.test.ts`, "elevated
  uniqueness checks do not leak into getOrganization's visibility") calls
  `existsBySlug` for a foreign organization's slug (confirming the
  elevation sees it, as designed) and then calls `getOrganization` for
  that same foreign organization's id **within the same transaction**,
  confirming it still returns `null` — proving `RESET ROLE` actually took
  effect before the next query ran, not merely that a fresh transaction
  would have started unprivileged.

## Sorting guarantees

Both list queries sort in the application layer, after mapping to DTOs,
not via `ORDER BY` in the repository's SQL — `listForOrganization` is a
shared, unordered-by-contract repository method, and adding an `ORDER BY`
there would be a de facto new repository capability (arguably a "new
repository method" in spirit, which Section 2 asks to avoid absent a
proven gap). Both sorts are ascending and stable in practice (`Array.sort`
is guaranteed stable per the ECMAScript spec since ES2019):

- `listOrganizationMembers`: by `joinedAt` ascending (Section 5).
- `listPendingInvitations`: by `createdAt` ascending (Section 6).

Neither sort has a documented tiebreak for two rows sharing the exact
same instant — no test scenario in this task produces that case, and no
tiebreak was invented speculatively (Section 14: "keep the read side
minimal and explicit").

## Future pagination note

**Not implemented (Section 14: "do not add pagination yet").** Both list
queries currently return every matching row in one call — acceptable for
an alpha-stage module where no organization has a membership or
invitation count anywhere near a size where this matters. If pagination
is added later, the natural seam is each query's own `deps`/return type
(e.g., a `{ limit, cursor }` parameter and a `{ items, nextCursor }`
return shape) — it does not require a repository change, since
`listForOrganization` already returns every row; a future pagination
layer would slice the already-fetched array, or (if row counts genuinely
demand it) a real repository-level `LIMIT`/`OFFSET`/keyset method would
become the "proven gap" Section 2 anticipates.

## Future filtering note

**Not implemented (Section 14: "do not add filtering yet").** No query
here accepts a role filter, a name/email search term, or a date range.
`listPendingInvitations`'s one filter (`status === PENDING`) is not a
counterexample — it is not caller-configurable, it is the query's entire
identity (Section 6: "exclude non-pending invitations" is not optional
behavior, it is what distinguishes this query from
`listOrganizationMembers`'s sibling shape). A future filtering feature
should follow the same seam as pagination: extend a query's own
parameter and return shape first, and reach for a new repository method
only once an existing `listForOrganization`-style method genuinely cannot
express the filter (e.g., a filter unrepresentable without an index the
current schema lacks).

## Permanent policy reaffirmed (Section 11)

Aggregates for commands, DTOs for queries, RLS for visibility, no
authorization logic in query services, query shape owned by the
application layer — all five are the design this task shipped, not
aspirations for a future task.

## What's still open, not resolved here

- **No HTTP handlers** expose these queries yet (Sections 1/14) — they
  are called directly in tests and via `TenancyWorkflowHarness`'s new
  `getOrganization`/`listOrganizationMembers`/`listPendingInvitations`
  wrapper methods (`test-support/workflow-harness.ts`), the same "thin,
  strongly-typed wrapper" pattern the three write-side use cases already
  use.
- **No pagination, no filtering, no search** (Section 14) — see the two
  notes above.
- **No query-level caching.** Every call re-runs a real query inside a
  real (if trivial) transaction; nothing here assumes or introduces a
  cache.
- **`findByUserId`'s "current membership" ordering caveat** (documented
  in tenancy-postgres-adapters.md) is unrelated to these queries but
  worth restating: `listOrganizationMembers` returns every membership
  row for the organization, so it does not inherit that ambiguity —
  unlike `findByUserId`, there is no "which one is current" question when
  listing every member.
