# E05-T02 — Organization Domain Model: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T02 only. Do not implement
  persistence, RLS, HTTP handlers, or background jobs." Sections 1–13.
- **Verdict:** **Complete**, pure domain model, exactly as scoped.

## What shipped

In `packages/tenancy/src/domain/`:

| File | Contents |
| --- | --- |
| `organization-id.ts` | `OrganizationId` value object — UUID validation, lowercase normalization, value equality, frozen/immutable |
| `organization-slug.ts` | `OrganizationSlug` value object — 3–50 chars, lowercase/digits/hyphens, rejects (not normalizes) invalid input |
| `organization-status.ts` | `OrganizationStatus` (`ACTIVE`/`SUSPENDED`/`DELETED`) + `isLegalOrganizationStatusTransition` — the single source of truth for the transition table |
| `organization-events.ts` | `OrganizationDomainEvent` discriminated union (5 event types) — module-local facts, not kernel `DomainEvent`s |
| `organization.ts` | The `Organization` aggregate: private fields, `create`/`rename`/`suspend`/`reactivate`/`delete` methods, `pullDomainEvents()`/`clearDomainEvents()` |

Full design writeup: [docs/modules/organization-domain.md](organization-domain.md)
(boundaries, invariants, a Mermaid transition diagram, event list, usage
example, non-goals).

**Tests:** 4 new files, 71 new tests (tenancy package: 8→79 total) —
value-object validation/equality/immutability, status transition legality,
aggregate creation/rename/suspend/reactivate/delete, the rename no-op
carve-out, the suspend/reactivate-must-change-state rule, event emission
and ordering, monotonic-timestamp enforcement, and defensive-copy
immutability on the `Date`-returning getters.

## A factual correction to the directive, made explicit rather than silently patched

Section 8 said to "use the existing aggregate event pattern from the
platform." No such pattern exists — verified by a dedicated codebase
search before writing any code. The actual, established convention
(`examples/acme-crm-module`) is: domain objects are inert data with pure
validation functions; a use case in the application layer generates ids/
timestamps via injected `IdGenerator`/`Clock` and constructs+publishes
kernel `DomainEvent`s through `UnitOfWork.publish()`. There is no
"aggregate self-raises events, pulled later" machinery anywhere.

Section 8's *requirement* (`pullDomainEvents()`/`clearDomainEvents()`) is
still implemented — as methods on `Organization` itself, not a new shared
platform base class. Introducing a shared `AggregateRoot` would be a
platform-architecture decision with cross-module blast radius, out of
scope for a single aggregate's domain task. The aggregate's events are a
module-local type (`OrganizationDomainEvent`), deliberately not a kernel
`DomainEvent` (no `actor`/`correlationId`/`causationId` — the aggregate
has no `Context`). The mapping from these facts to the wire-level events
already defined in `application/events.ts` (E05-T01) is documented as a
future use case's job, not built here.

## Another reconciliation, flagged rather than silently resolved

The E05-T01 scaffold's placeholder `OrganizationRecord` had a `kind`
(`personal`/`team`) field and a four-state status model
(`active`/`suspended`/`pending_deletion`/`purged`), matching
`docs/modules/tenancy-contract.md`'s forward-looking blueprint reference.
This directive's Section 4 (three states) and Section 5 (no `kind` in the
field list) are the current, explicit instruction — followed as given.
`OrganizationRecord` is deleted (superseded); the reconciliation between
the two models is recorded in `organization-domain.md`'s non-goals for
whichever future task (E05-T13's purge protocol, E05-T21's persistence)
needs to decide it, not guessed at here.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` — all pass.
- `eslint .` — zero findings.
- `pnpm -r test` — 444 tests across 49 files in the unit/application
  lanes (tenancy alone: 79, up from 8), plus platform's unchanged 97
  integration tests and acme-crm's unchanged 4 (not run by this command,
  unaffected by this task).
- Architecture-fitness suite — unchanged at 36 tests across 5 files:
  `organization.ts` isn't repository-named, so the tenant-isolation
  fitness rule doesn't touch it; no new package/manifest surface.
- Export-surface snapshot — updated and checked in. New exports:
  `Organization`, `OrganizationId`, `OrganizationSlug`, `OrganizationStatus`,
  `isLegalOrganizationStatusTransition`.

## Permanent policy (Section 12, adopted)

Value objects first; explicit transitions; terminal states enforced
structurally (empty transition-table entries, not scattered `if`s); no
public mutation; events are facts, not commands; no infrastructure
leakage (no `Context`/`IdGenerator`/`Clock` inside the aggregate); no ORM
annotations in domain code; invariants documented in TSDoc at the exact
call site that enforces them. `Organization` is the first instance, not
just the policy statement.

## Release-pipeline debt (not fixed here, not new)

Still no changeset for `@corestack/tenancy`, and it's still `0.0.1` while
kernel/platform are `0.1.0`. This is the third task in a row adding public
surface to an unversioned publishable package (T01 flagged it first).
Not a blocker — `RELEASE_ENABLED` stays off — but it's a pattern now, not
an oversight, and should be reconciled before any real publish.

## Next

**E05-T03: the `Membership` aggregate.** Not started. Per Section 14,
work stops here pending the next prompt.
