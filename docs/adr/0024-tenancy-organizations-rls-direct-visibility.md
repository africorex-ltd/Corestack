# ADR 0024: `tenancy.organizations`' RLS policy uses direct (id-keyed) visibility, not membership-driven

- **Status:** Accepted
- **Date:** 2026-07-30
- **Elaborated in:** [ADR-0008](0008-pooled-multi-tenancy.md), [ADR-0023](0023-tenancy-schema-text-enum-with-check-constraint.md)

## Context

`OrganizationRepository`'s own port doc (E05-T01) has flagged this
question since before any RLS work existed: a row in
`tenancy.organizations` *is* an organization, not something merely
scoped *to* one via an `organization_id` column the way `memberships`/
`invitations` rows are. The platform's generic tenant-isolation policy
(`buildTenantIsolationDdl`, E03-T30) assumes the latter shape — it can't
apply verbatim here.

E05-T10's founder directive (Section 4) asks this task to resolve the
question explicitly, choosing one of:

- **A. Membership-driven visibility** — a session can read every
  organization it has an active membership row in, regardless of which
  organization is "current."
- **B. Direct organization visibility** — a session can read only the
  one organization matching its current tenant context.
- **C. Hybrid** — some combination of A and B.

The directive also states four capabilities the decision must support:
reading the current organization; reading organizations the user belongs
to; future ownership transfer; future cross-organization administration.
Separately (Section 3), the directive is explicit: reuse the platform's
existing tenant-context mechanism and introduce no new one.

## The deciding constraint: no user-identity session mechanism exists

Options A and C both require the RLS policy to know **which user** is
running the query, not just which organization. Concretely, a
membership-join condition needs something like:

```sql
EXISTS (
  SELECT 1 FROM tenancy.memberships m
  WHERE m.organization_id = organizations.id
    AND m.user_id = current_setting('app.current_user')::uuid
    AND m.status = 'ACTIVE'
)
```

No `app.current_user`-equivalent session variable exists anywhere in
this codebase today — confirmed by search across `packages/platform`,
`packages/kernel`, and every migration/certification doc. The one
tenant-context mechanism that exists, `app.current_org` (`ADR-0008`
layer 3; `packages/platform/src/infrastructure/postgres-org-context.ts`;
certified end-to-end in
`docs/security/tenant-isolation-certification.md`), identifies an
*organization*, not a *user*. Building option A or C would mean
inventing a second, parallel session-context mechanism to identify the
querying user — directly contradicting Section 3's "do not introduce a
new mechanism," which is unambiguous and already-tested, unlike the
literal session-variable name Section 3 also mentions (see this ADR's
"A note on Section 3's literal wording" below).

## Decision

**`tenancy.organizations` uses direct (Option B) visibility**: `id =
current_setting('app.current_org')::uuid`, applied uniformly across
`SELECT`, `INSERT`, and `UPDATE` (see
`packages/tenancy/src/infrastructure/postgres/rls/organizations-policies.ts`).
This reuses the exact same mechanism, and the exact same session
variable, every other tenancy table's RLS policy already uses — zero new
mechanism.

This still satisfies all four required capabilities:

1. **Reading the current organization** — the direct case; trivially
   supported.
2. **Reading organizations the user belongs to** — **not** served by
   this table's own RLS policy (that would require the missing
   user-identity mechanism above). Instead, this is an application-layer
   concern: a future "list my organizations" read runs as the
   **platform role** (already exists, already bypasses org-scoped RLS by
   design — the same role relay/sweeper/support tooling already uses),
   filtering `tenancy.memberships` by `user_id` at the query level, then
   joining to `tenancy.organizations`. This is the same class of
   legitimately-cross-tenant read the platform role was built for; no
   new bypass is required (see Section 14: "do not add cross-organization
   admin bypasses yet" — none is needed, since one already exists
   generically).
3. **Future ownership transfer** — an entirely `memberships`-level
   operation (promote one row, demote/remove another), already served by
   `memberships`' own org-scoped `UPDATE` policy. `organizations`'
   visibility model is orthogonal to this capability.
4. **Future cross-organization administration** — served by the
   `organizations_platform_full_access` policy (`FOR ALL`, `USING
   (true)`, `TO tenancy_platform`), the same pattern every other tenancy
   table already has. No new admin-specific mechanism was added.

**`INSERT` uses the identical `id = current_setting('app.current_org')`
check, not a special-cased "no org yet" bypass.** `Organization`'s id is
application-generated (via `IdGenerator`) *before* persistence
(Architecture rule 2), and `OrganizationRepository.save`'s signature
(`save(context: Context, organization: Organization)`) takes a plain
`Context` for both creation and later updates — `context.organizationId`
was never a reliable signal for either case. The expected future adapter
sets `app.current_org` from the **aggregate's own `organization.id`**
(via `PostgresUnitOfWork`'s constructor parameter) for every `save` call,
creation included. This means organization creation needs no
special-cased RLS bypass at all — it uses the same predicate as every
other write in this system.

## A note on Section 3's literal wording

Section 3 names the session variable as `current_setting('app.current_organization_id')`.
The platform's actual, sole, already-certified mechanism is
`app.current_org` (dozens of references across
`packages/platform`, the tenant-isolation certification, `ARCHITECTURE.md`,
`DATABASE.md`, and `examples/acme-crm-module`'s own migration — confirmed
by search; `app.current_organization_id` appears nowhere in this
codebase before this task). Section 3's own other instruction — "Use the
platform RLS mechanism... Do not introduce a new mechanism" — is
unambiguous and already-tested; introducing a second, differently-named
session variable would itself be introducing a new, parallel mechanism,
contradicting that same sentence. This ADR (and every RLS policy this
task ships) uses `app.current_org`, treating the literal variable name in
Section 3 as an imprecise gloss rather than a deliberate instruction to
change tested production security infrastructure. See
`docs/modules/tenancy-rls-design.md`'s "Fail-closed behaviour" section
for the full reconciliation note.

## Alternatives considered

- **A. Membership-driven visibility:** rejected — requires a
  currently-nonexistent user-identity session mechanism, contradicting
  Section 3.
- **C. Hybrid (direct + membership-join):** rejected for the same reason
  as A — the membership-join half still requires the missing mechanism;
  adding it only for some queries doesn't remove the dependency.
- **Introduce `app.current_user` now, to unlock A/C properly:** rejected
  — out of scope for this task (Section 3/14), and a real design
  decision in its own right (how is it set? by which layer? does it
  interact with session pooling the way `app.current_org` already had to
  work through, per the tenant-isolation certification's empirical
  findings?) that deserves its own dedicated task, not a byproduct of
  resolving this one question.

## Consequences

- `organizations`, `memberships`, and `invitations` all key their RLS
  policies off `app.current_org` — one mechanism, one session variable,
  across the entire module.
- "List my organizations" (an org-switcher UI, for example) is
  explicitly **not** an app-role-RLS-scoped query today; a future task
  building that experience must either run it as the platform role (as
  described above) or introduce the user-identity mechanism this ADR
  deliberately declines to build now — flagged, not silently
  unsupported.
- The future Postgres adapter for `OrganizationRepository.save` must set
  `app.current_org` from the aggregate's own `id`, not from whatever the
  calling `Context` happens to carry — documented explicitly so the
  adapter task doesn't have to re-derive this from first principles.
