# ADR 0023: Tenancy schema encodes enums as CHECK-constrained `text`, not native Postgres `ENUM` types

- **Status:** Accepted
- **Date:** 2026-07-30
- **Elaborated in:** [DATABASE.md §1 rule 5](../architecture/DATABASE.md), [ADR-0017](0017-drizzle-deferred-to-first-module-repository.md)

## Context

E05-T09's founder directive (Section 7) asks to "create database enums
matching the current domain model" for `Organization`'s status,
`Membership`'s role/status, and `Invitation`'s role/status. Read
literally, "database enum" suggests PostgreSQL's native `CREATE TYPE ...
AS ENUM (...)` mechanism, which Drizzle exposes as `pgEnum`.

`docs/architecture/DATABASE.md`'s Global Design Decision #5 already
settled this question, before this task existed: **"Status/enum columns
are `text` + `CHECK` constraint, not native Postgres enums. _Why:_ adding
a value to a native enum is easy, but removing/renaming is painful and
lock-prone; `CHECK` constraints version cleanly with expand-and-contract
migrations."** This is exactly the situation the tenancy domain model is
already in: `OrganizationStatus`'s own code comment
(`organization-status.ts`) flags a live, unresolved 3-state-vs-4-state
reconciliation with `tenancy-contract.md`'s blueprint — a concrete,
foreseeable future change to that exact enum's value set. Native
Postgres enums make renaming/removing a value require rebuilding the
type (`ALTER TYPE ... RENAME VALUE` exists for renames since PG10, but
removal has no built-in support at all — the standard workaround is
dropping and recreating the whole type, non-trivial under load); a
`CHECK` constraint that references a literal value list is a plain
`ALTER TABLE ... DROP CONSTRAINT` / `ADD CONSTRAINT` swap, no different
in kind from any other schema migration this project already runs
(T01's plain-SQL migration format, `platform.module_migrations`-tracked).

## Decision

**Every enum-shaped column in `packages/tenancy/src/infrastructure/postgres/schema/`
is declared with Drizzle's `text(column, { enum: [...] })` builder — plain
`text` at the database level, with a TypeScript literal-union type at the
application level — plus an explicit `CHECK` constraint (via Drizzle's
`check()` table-extra-config entry) enumerating the same value list.**
This satisfies Section 7's request in spirit — the database genuinely
rejects a row whose status/role isn't one of the domain model's known
values, and the column's shape is unambiguous to any reader — using the
mechanism the approved architecture already specified, not `pgEnum`'s
native `CREATE TYPE`.

Concretely, each enum value list is written once, sourced directly from
the same constant object the domain aggregate already exports
(`OrganizationStatus`, `MembershipRole`, `MembershipStatus`,
`InvitationRole`, `InvitationStatus`) — not re-typed as an independent
string-literal array. This means a future rename of a domain enum value
breaks the schema file at compile time (a `tsc` error, not a silent
drift), which is a stronger guarantee than a schema test that merely
compares two independently-authored lists for equality (E05-T09 Section
10 still adds that test too, as a second line of defense against a
future refactor that stops importing the domain constant directly).

## Alternatives considered

- **Use Drizzle's `pgEnum`, matching Section 7's literal wording exactly:**
  rejected — this is precisely the native-enum-evolution pain DATABASE.md
  rule 5 already ruled out, and `OrganizationStatus` is a specific,
  named, not-yet-resolved case of an enum whose value set is expected to
  change. Choosing `pgEnum` here would mean re-deciding this question
  differently for every other module's schema later, or living with an
  inconsistency the founder directive itself gives no reason to want.
- **Plain `text()` with no `{ enum: [...] }` option, relying on the
  `CHECK` constraint alone:** rejected — `{ enum: [...] }` costs nothing
  at the database level (identical generated column type) and gives every
  TypeScript caller a literal union instead of a bare `string`, which is
  strictly more useful with no schema-shape tradeoff.
- **Revisit DATABASE.md's rule 5 given a specific founder instruction
  that reads native-enum:** rejected — nothing about this task's actual
  need (a small, evolving set of lifecycle states) contradicts rule 5's
  stated rationale; there is no new evidence that native enums are
  actually preferable here, only a wording ambiguity in one section
  header.

## Consequences

- Every future module's schema inherits this same pattern by construction
  (`docs/modules/tenancy-schema-design.md`'s "index rationale" section
  cross-references this ADR), keeping enum evolution uniform across
  modules — the exact kind of "permanent policy" Section 14 of the E05-T09
  directive already asks to adopt repo-wide ("no ORM-driven implicit
  constraints").
- `packages/tenancy/test/infrastructure/schema.test.ts` asserts, for every
  enum-shaped column: `column.enumValues` (Drizzle's `{ enum: [...] }`
  option) equals the domain enum's own value set, and a corresponding
  `CHECK` constraint exists in `getTableConfig(table).checks`. Both
  properties are checked without a live database connection.
- If a future module's engineer reaches for `pgEnum` out of habit, code
  review has this ADR to point to; nothing in the Drizzle schema tooling
  itself prevents `pgEnum` from being used, since Drizzle supports both.
