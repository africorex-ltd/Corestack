# `@corestack/tenancy` — Future Public Contract

- **Effort:** E05 Readiness Gate, Section 7.
- **Status:** **Specification only. No implementation code exists.** This
  document defines what E05 (`docs/engineering/02-identity.md`, 30 tasks,
  F5.1–F5.6) will build, grounded directly in the blueprint's own task
  rows — not invented ahead of it. Where the blueprint is silent on a
  detail, this document says so explicitly rather than filling the gap
  with an implementation decision that belongs to E05 itself.
- **Why this exists now, before E05 starts:** per Section 10's proposed
  permanent policy ("every new module begins with a contract document"),
  this is the first exercise of that policy — written before, not after,
  the module it describes.

## Purpose

Tenancy is the platform's unit of tenancy: organizations, memberships,
and invitations. It is also **the module template every later module
copies** (E05-T01's acceptance criterion) — its scaffold, once built,
becomes the canonical answer to this readiness gate's own friction-log
finding that no module scaffold currently exists (see
`e05-readiness-friction-log.md`, step 1).

## Aggregates

| Aggregate | Key invariants (blueprint E05-T02–T04) |
| --- | --- |
| `Organization` | Name/slug format rules; `kind` is `personal` or `team`; status machine `active → suspended → pending_deletion → purged`, legal transitions only; personal orgs are undeletable while they're a user's sole login (constraint deferred to the auth link, E06) |
| `Membership` | Baseline role from a closed set (`owner`/`admin`/`member`); status; join semantics |
| `Invitation` | Email-addressed; single-use token, **hash-only storage** (raw token never persisted); expiry enforced; `accepted`/`revoked` are terminal states; a "never-owner" rule (an invitation can never grant the owner role directly — API §5) |

## Commands (application layer, E05-T07–T20)

| Command | Behavior contract |
| --- | --- |
| `CreateOrganization` | Team org creation; creator becomes owner membership **atomically** (one `UnitOfWork`); slug collision → `ConflictError`; emits events |
| `CreatePersonalOrganization` | Auto-created by consuming the `user.registered` event (from E06); **idempotent on event replay** (via `ProcessedEventStore`, matching every other idempotent consumer in this codebase) |
| `GetOrganization` / `ListMyOrganizations` | Read-only; a cross-org read attempt returns `NotFoundError`, never a distinguishable "forbidden" (closes the same enumeration side-channel `resolveContext` already closes) |
| `UpdateOrganization` | Name/slug change with **optimistic version** checking; stale version → `ConflictError`; a slug change surfaces a warning in the response DTO |
| `DeleteOrganization` / `RestoreOrganization` | **Two-phase**: `pending_deletion` with a restore window, then `purge_after` triggers the fan-out purge (reusing E03-T33's `organization.purge_requested` protocol, not a new mechanism) |
| `TransferOwnership` | Explicit command; only the current owner may call it; target must be an active member; old owner becomes admin; audited |
| `ListMembers` | Filter by status/role, sort by `joinedAt`, cursor pagination (API §22's pagination convention, not a module-specific one) |
| `UpdateMemberRole` | **Sole-owner guard**: a concurrent demote-the-last-owner race must lose deterministically (tested with an induced race) — a `tenancy/sole_owner` error code |
| `RemoveMember` | Permissioned removal; self-removal is always allowed as a right (API §5) but still subject to the sole-owner guard |
| `InviteMember` | Pending-uniqueness: one pending invitation per `(org, email)`; re-inviting resends rather than duplicating; raw token appears **only** in the outgoing notification event's payload, never stored |
| `RevokeInvitation` / `ListInvitations` | History rows are retained (DB §17's audit-retention convention), not hard-deleted |
| `PreviewInvitation` | Public, unauthenticated; returns a safe subset only; an invalid and an expired token must be **indistinguishable** (`NotFoundError` for both — same enumeration-resistance discipline as `GetOrganization`) |
| `AcceptInvitation` | Join flow; composes with auth's registration flow for invited-before-registration (Sequencing Rule 2); single-use enforced **inside the consuming transaction**; email match required; resulting membership carries the invited role |

## Events

| Event | Emitted by |
| --- | --- |
| `organization.created` / `.updated` / `.deleted` | `Organization` aggregate lifecycle (E05-T02.3) |
| `member.joined` / `.updated` / `.removed` | `Membership` lifecycle (E05-T03) |

All events follow the kernel's existing `DomainEvent` envelope
(versioned, JSON-round-trippable) — no new event mechanism, consistent
with every module before it.

## Repositories (ports, E05-T06)

`OrganizationRepository`, `MembershipRepository`, `InvitationRepository`
— all **org-scoped signatures** per E03-T31's `OrgScopedContext` pattern
(the type-level "cannot call without a resolved org" guarantee). Ports
are declared in domain terms; each gets a contract suite declared
(reusing the `@corestack/kernel/testing` framework's pattern, though these
are module-specific ports, not kernel ports — the contract-suite
*technique* transfers, the suites themselves live in `@corestack/tenancy`,
not in `@corestack/kernel/testing`).

## Health signals

**Not specified by the blueprint at the task level** — E05's task list has
no row explicitly defining Tenancy's own `health()` implementation, and
the friction log (Section 2/3, step 10) found that `examples/acme-crm-
module`'s own health check is a hardcoded stub, giving no real precedent
to follow. This is a genuine open question for E05-T01 (module scaffold)
to resolve, not something this contract document should invent. A
plausible signal set, offered as a starting point for that task rather
than a settled decision: database reachability for the tenancy schema
specifically (distinguishing "the org table is unreachable" from a
platform-wide database outage `checkReadiness` would already catch), and
a count of `pending_deletion` orgs past their `purge_after` window that
haven't been swept (an operational backlog signal, the same pattern
`checkReadiness`'s relay-lag and backlog checks already establish for the
outbox).

## Purge semantics

Reuses E03-T33's purge protocol directly: `registerPurgeHandler("tenancy",
handler, processedEventStore)` on `organization.purge_requested`,
idempotent via the same `ProcessedEventStore`-backed mechanism every
other module (including the golden path) already uses. E05-T13's
acceptance criterion is exactly this: "idempotent; completion tracked."
No new purge mechanism — Tenancy is a **consumer** of the existing
protocol, the same as `acme-crm-module`'s own purge handler, not a
special case (notably, Tenancy is also the module whose own `Organization`
aggregate status machine *originates* the purge request in the first
place, via the delete/purge two-phase flow above — it is both the
initiator and, for its own data, a subscriber).

## RLS requirements

All three tables (`organizations`, `memberships`, `invitations`) get RLS
per DB §5 and E03-T30's harness (E05-T21's acceptance criterion states
this exactly: "RLS on all three tables"). This is also where the
friction log's step-6 finding (no bridge from `buildTenantIsolationDdl()`
to an actual migration file) becomes concretely load-bearing for the
first time outside the golden path — Tenancy's migrations are exactly the
kind of real, security-relevant DDL where hand-transcription risk
matters, not a hypothetical concern.

**Open question the blueprint itself doesn't resolve**: `organizations`
is arguably the tenant-defining table itself, not a tenant-owned table in
the usual sense (a row *is* an organization, not something scoped *to* one
via `organization_id`). Whether `organizations` needs the standard
`tenant_isolation`/`platform_full_access` RLS pattern, or a different
policy shape (e.g., a member can only see orgs they belong to, which is a
membership-join condition, not a simple `organization_id = current_setting(...)`
comparison), is a real design decision for E05-T21, not something this
contract document should pre-decide.

## Configuration surface

Not detailed in the blueprint beyond "invitation expiry configurable"
(E05-T17) and rate-limit tiers for the public invitation endpoints
(E05-T25, "API §15 unauthenticated tier"). Expected shape, following the
established `ModuleConfigSpec` pattern (`config-validation.md`,
demonstrated end-to-end for the first time properly in E05 — recall the
friction log's step-3 finding that the golden path's own config spec is
never actually exercised): an invitation-expiry duration, and rate-limit
policy values for `PreviewInvitation`/`AcceptInvitation`'s public,
unauthenticated endpoints.

## Extension points

- **Module template extraction (E05-T29)**: once Tenancy ships, its
  scaffold becomes the literal template E06 (Auth) and every module after
  it copies (E06-T01's dependency is explicitly "Module scaffold from
  template (E05-T29)"). This is the mechanism that resolves the friction
  log's step-1 finding — not a new tool, but Tenancy's own structure
  becoming the reusable answer.
- **`Tenancy /testing` subpath (E05-T28)**: adopter-facing fakes and
  fixtures, contract-tested, following `@corestack/platform/testing`'s
  existing subpath convention — the first module-level instance of that
  pattern.
- **Auth composition points**: `CreatePersonalOrganization` consumes
  `user.registered` (from E06); `AcceptInvitation` composes with E06's
  registration flow for invited-before-registration; `DeleteMyAccount`
  (E06-T18) depends on Tenancy's sole-owner guard (`E05-T15`) to block
  deletion that would strand an organization. These are the seams E06
  must respect, not decisions E06 gets to make independently.

## What this document deliberately does not do

No implementation code, no repository schema (that's E05-T21's job), no
decision on the two open questions flagged above (`organizations`' own
RLS shape; Tenancy's real health signals) — both are correctly scoped to
E05's own tasks, not pre-empted here. This document's job is to give E05
a written target to build against and a written record of what was
already decided (via the blueprint) versus what remains a real design
decision for the tasks themselves.
