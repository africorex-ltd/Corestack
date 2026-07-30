# Tenancy Persistence Mapping (E05-T09)

- **Status:** design only — no repository adapter reads or writes any of
  this yet (E05-T09 Section 2/16: no repository methods, no SQL, no RLS,
  no migrations beyond the schema definitions themselves).
- **Scope:** how each of the three implemented aggregates
  (`Organization` E05-T02, `Membership` E05-T04, `Invitation` E05-T05)
  maps to its Postgres row, defined in
  `packages/tenancy/src/infrastructure/postgres/schema/`.
- **Companion doc:** [tenancy-schema-design.md](tenancy-schema-design.md)
  covers the ER diagram, index rationale, and repository/RLS expectations
  this doc's mapping rules feed into.

## Why this document exists

`docs/modules/tenancy-workflow-integration.md` (E05-T08) proved the
tenancy workflow end-to-end against in-memory repositories. Before a
real Postgres adapter can replace those in-memory repositories
(a later task, explicitly out of scope here), the exact row shape each
aggregate maps to must be frozen — otherwise "the adapter" is really
"the adapter and an undocumented schema improvised alongside it,"
exactly the coupling this task exists to prevent (Section 1: "freezes
the database shape... before adapter implementation").

## General mapping rules

1. **A repository reconstitutes the aggregate; it does not hand back
   the row.** Every aggregate's private constructor is `private` — the
   only way to obtain an instance is `Aggregate.create(...)` (a brand
   new row) or a future adapter's own reconstitution path. This document
   assumes that reconstitution path exists (as `OrganizationRepository`'s
   own doc already says: "a repository reconstitutes the aggregate from
   persisted rows, it doesn't hand back an anemic DTO") — building it is
   the eventual adapter task's job, not this one's.
2. **Value objects map to their wrapped primitive, one column each.**
   `OrganizationId`/`MembershipId`/`InvitationId`/`UserId` all wrap a
   lowercase-normalized UUID string → `uuid` column, no separate
   validation at the database layer beyond the column type itself (the
   value object already validated the shape before the aggregate ever
   held it). `OrganizationSlug` → `text` (already validated: 3–50 chars,
   `[a-z0-9]+(-[a-z0-9]+)*`). `Email` → `text` (already normalized:
   trimmed and lowercased by `Email.from`, before the aggregate ever
   holds it — DATABASE.md §1 rule 9's "stored lowercased... not
   `citext`," satisfied at the value-object boundary rather than a
   database expression).
3. **Timestamps map 1:1 to `timestamptz` columns, application-supplied,
   with no DB-side default.** Every aggregate takes `now: Date` as
   caller-supplied data, never reads the wall clock itself. The row's
   timestamp columns store exactly the `Date` the aggregate was
   constructed/transitioned with. Unlike DATABASE.md §1 rule 6's general
   "`created_at` (default `now()`)" guidance, this schema's
   `created_at`/`joined_at` columns carry **no** `.defaultNow()` — a
   creation timestamp must equal the same instant already published on
   the aggregate's own creation event (`OrganizationCreated`/
   `MembershipCreated`/`InvitationCreated`'s `occurredAt`), and a
   DB-computed fallback would silently desynchronize the two if a future
   insert path ever omitted the column (Drizzle only makes a column
   optional in its insert type when it has a default — omitting the
   default keeps every insert obligated to supply the real value, the
   same discipline rule 2 already applies to ids via no `.defaultRandom()`).
4. **Enum-shaped fields (status, role) map to CHECK-constrained `text`,
   not native Postgres `ENUM` types** — see
   [ADR-0023](../adr/0023-tenancy-schema-text-enum-with-check-constraint.md).
   The column's value set is sourced directly from the same domain
   constant object the aggregate exports (not re-typed independently), so
   a renamed domain enum value is a compile error in the schema file, not
   a silent drift.
5. **Nullable fields are exactly the aggregate's own nullable getters,
   nothing more.** A field that is `null` only in one specific terminal
   state (`deletedAt`, `removedAt`) is nullable in the schema and
   `NOT NULL`-free; every other field the aggregate always has a value
   for is `NOT NULL`.
6. **No `version`/optimistic-concurrency column on any of the three
   tables** — none of the three aggregates carries a version counter
   today. See "Concurrency expectations" in
   [tenancy-schema-design.md](tenancy-schema-design.md) for what this
   means in practice and what doesn't protect against races yet.

## `Organization` → `tenancy.organizations`

| Aggregate field | Type | Column | Mapping notes |
| --- | --- | --- | --- |
| `id` | `OrganizationId` | `id uuid PK` | Value-object `.value`, already-validated UUID |
| `name` | `string` | `name text NOT NULL` | 1–120 chars, validated by the aggregate; no length constraint duplicated at the DB layer (Section 2 scope: schema, not repository-level re-validation) |
| `slug` | `OrganizationSlug` | `slug text NOT NULL` | `.value`; unique (plain `UNIQUE`, not partial — see schema-design doc) |
| `status` | `OrganizationStatus` | `status text NOT NULL` | `ACTIVE`/`SUSPENDED`/`DELETED`; CHECK-constrained (ADR-0023) |
| `createdAt` | `Date` | `created_at timestamptz NOT NULL` | Set once, at `create()`; no DB default (rule 3) |
| `updatedAt` | `Date` | `updated_at timestamptz NOT NULL` | Every mutating method (`rename`/`suspend`/`reactivate`/`delete`) rewrites this; no DB default |
| `deletedAt` | `Date \| null` | `deleted_at timestamptz NULL` | `null` unless `status = 'DELETED'`; set exactly once, by `delete()` |
| *(none)* | — | *(no `version`)* | See rule 6 above |
| *(none — blueprint-only)* | — | *(no `kind` column)* | `tenancy-contract.md`'s `personal`/`team` blueprint field has no aggregate equivalent (E05-T02's own tracked non-goal) |

Domain events (`OrganizationCreated`/`Renamed`/`Suspended`/`Reactivated`/
`Deleted`) are not persisted as rows on this table — they flow through
`UnitOfWork`/the outbox (`platform.outbox`), a separate concern from the
aggregate's own row.

## `Membership` → `tenancy.memberships`

| Aggregate field | Type | Column | Mapping notes |
| --- | --- | --- | --- |
| `id` | `MembershipId` | `id uuid PK` | |
| `organizationId` | `OrganizationId` | `organization_id uuid NOT NULL FK→organizations(id) CASCADE` | Within-schema FK (DATABASE.md §1 rule 4) |
| `userId` | `UserId` | `user_id uuid NOT NULL` | No FK — cross-module by-id reference (no `auth` schema exists yet) |
| `role` | `MembershipRole` | `role text NOT NULL` | `OWNER`/`ADMIN`/`MEMBER`; CHECK-constrained |
| `status` | `MembershipStatus` | `status text NOT NULL` | `ACTIVE`/`SUSPENDED`/`REMOVED`; CHECK-constrained |
| `joinedAt` | `Date` | `joined_at timestamptz NOT NULL` | Doubles as this row's creation timestamp — the aggregate has no separate `createdAt`; no DB default (rule 3) |
| `updatedAt` | `Date` | `updated_at timestamptz NOT NULL` | Rewritten by every role/status transition |
| `removedAt` | `Date \| null` | `removed_at timestamptz NULL` | `null` unless `status = 'REMOVED'` |
| *(none)* | — | *(no `version`)* | See rule 6 above |

Role and status are independent axes on the aggregate (suspending never
changes role; promoting/demoting never changes status) — the schema
makes no attempt to couple them beyond each column's own CHECK.

## `Invitation` → `tenancy.invitations`

| Aggregate field | Type | Column | Mapping notes |
| --- | --- | --- | --- |
| `id` | `InvitationId` | `id uuid PK` | |
| `organizationId` | `OrganizationId` | `organization_id uuid NOT NULL FK→organizations(id) CASCADE` | |
| `email` | `Email` | `email text NOT NULL` | Already lowercase-normalized by `Email.from`; plain unique index, no `lower(...)` expression needed |
| `role` | `InvitationRole` | `role text NOT NULL` | `ADMIN`/`MEMBER` only (no `OWNER` — structurally excluded at the domain layer already); CHECK-constrained |
| `status` | `InvitationStatus` | `status text NOT NULL` | `PENDING`/`ACCEPTED`/`REVOKED`/`EXPIRED`; CHECK-constrained |
| `invitedBy` | `UserId` | `invited_by uuid NOT NULL` | No FK — same cross-module by-id rationale as `memberships.user_id` |
| `createdAt` | `Date` | `created_at timestamptz NOT NULL` | Set once, at `create()`; no DB default (rule 3) |
| `expiresAt` | `Date` | `expires_at timestamptz NOT NULL` | Strictly after `createdAt`, validated by the aggregate at creation |
| `respondedAt` | `Date \| null` | `responded_at timestamptz NULL` | `null` while `PENDING`; set exactly once, by whichever of `accept`/`revoke`/`expire` fires first |
| *(none)* | — | *(no `updatedAt`)* | The aggregate has none — `PENDING` is the only mutable state, and every terminal transition is one-way and one-time |
| *(none — blueprint-only)* | — | *(no `token_hash` column)* | Invitation-token generation/hashing is a repeatedly-flagged non-goal since E05-T05 — see `invitation-domain.md`'s non-goals |

## Terminal states, summarized

| Aggregate | Terminal state(s) | What freezes |
| --- | --- | --- |
| `Organization` | `DELETED` (one) | Every column stops changing; `deleted_at` is set once |
| `Membership` | `REMOVED` (one, independent of `role`) | `removed_at` set once; `role`/other columns frozen |
| `Invitation` | `ACCEPTED` / `REVOKED` / `EXPIRED` (three, mutually exclusive) | `responded_at` set once, by whichever fires first; `status` never changes again |

No table has a hard-delete path modeled here — every terminal state is a
row that still exists, with a status column recording why it stopped
changing. (Two-phase deletion / purge, per `tenancy-contract.md`'s
forward-looking blueprint, is an open reconciliation this schema
deliberately does not resolve — see `organization-domain.md`'s
non-goals and this doc's companion,
[tenancy-schema-design.md](tenancy-schema-design.md)'s "deletion
strategy" section.)
