# ADR 0026: `PostgresNotificationWorkItemRepository` is a `GlobalRepository`

- **Status:** Accepted
- **Date:** 2026-07-31
- **Builds on:** [ADR-0021](0021-globalrepository-marker-and-tenant-fitness-rules.md) (the `GlobalRepository` marker + fitness rule this decision satisfies)

## Context

E05-T14 adds `PostgresNotificationWorkItemRepository` (`packages/tenancy/src/infrastructure/postgres/postgres-notification-work-item-repository.ts`),
written to by the invitation-notification event consumer
(`invitation-notification-consumer.ts`). The architecture-fitness rule
ADR-0021 introduced (`packages/architecture-tests/test/tenant-isolation.test.mjs`)
requires every `*repository*.ts` source file to reference either
`OrgScopedContext` or `GlobalRepository` (with an ADR citation) — this
file did neither, and failed the fitness gate.

This repository is genuinely different from every other tenancy
repository (`PostgresOrganizationRepository`/`PostgresMembershipRepository`/
`PostgresInvitationRepository`, all E05-T11): those are called from
**use cases**, each running inside a caller-authenticated
`OrgScopedContext` and a `PostgresUnitOfWork` scoped to that context's
`organizationId` via `app.current_org`. `PostgresNotificationWorkItemRepository.create`
is called from an **event consumer** — there is no authenticated caller,
no per-request organization scope, and no `app.current_org` to set (the
consumer's own `PostgresUnitOfWork` is deliberately constructed with
`organizationId: null`, see that file's doc comment). Visibility instead
comes from `SET LOCAL ROLE tenancy_platform`, the same elevation
`PostgresOrganizationRepository.existsBySlug`/`findBySlug` (E05-T11) use
for their own structurally similar reason (a query that needs to act
outside the RLS-restricted `tenancy_app` scope). Every tenancy table's
`..._platform_full_access` RLS policy (E05-T10) already exists "for
future cross-organization administration"/"relay/sweepers/support
tooling" — this repository is the first real instance of that
anticipated case.

## Decision

`PostgresNotificationWorkItemRepository` implements `GlobalRepository`
(`@corestack/platform`) and cites this ADR in its own file, satisfying
the fitness rule honestly rather than mentioning `OrgScopedContext` in a
comment merely to pass a text-pattern check.

This is a narrower claim than ADR-0021's other listed examples
("platform-wide admin tooling, cross-tenant reporting, or a
migration/backfill utility") — this repository's one method still writes
exactly one organization's row per call (the row carries a real
`organization_id`, which the table's standard `tenancy_app`-facing RLS
policies (this task's migration) still enforce for any future caller
using that role). What makes it a `GlobalRepository` in ADR-0021's sense
is specifically the *absence of a per-call `OrgScopedContext`/
`app.current_org` touchpoint* — the caller is an event, not an
authenticated request — which is exactly the property the fitness rule
mechanically detects and exactly the property `GlobalRepository` exists
to flag as a reviewed, deliberate opt-out rather than an accidental
omission.

The application-layer port, `NotificationWorkItemRepository`
(`packages/tenancy/src/application/notification-work-item-repository.ts`),
does **not** implement `GlobalRepository` — its own doc comment contrasts
itself with `OrgScopedRepository` (T31) and, in doing so, mentions
`OrgScopedContext` in prose. That happens to satisfy the fitness rule's
text match on this file today, but this is an accident of wording, not a
design property: the rule is a blunt regex over file contents, and the
port's `tx: TransactionContext` signature is deliberately
infrastructure-agnostic and says nothing about scoping either way — only
the concrete Postgres adapter makes the global-access choice this ADR
approves. **Known fragility, noted deliberately rather than left
silent:** if a future edit rewords that comment and drops the
`OrgScopedContext` mention, the fitness rule will fail on this port file
with no actual scoping change having occurred. The port file itself
carries a matching note pointing back here. The correct response in that
case is to restore some literal mention (or, more robustly, add the
`GlobalRepository` marker to the port too) — not to weaken the fitness
rule, and not to conclude the port suddenly needs real org-scoping logic
it never had.

## Alternatives considered

- **Add an `OrgScopedContext` parameter to `create` purely to satisfy the
  fitness rule**: rejected — there is no real caller context to pass; a
  parameter accepted only to appease a text scanner, never meaningfully
  used, is worse than an honest `GlobalRepository` declaration (exactly
  the kind of "unused surface" this task's own second advisor pass
  (E05-T13's `requireNonEmptyString` removal) already established as a
  mistake to avoid).
- **Thread `app.current_org` from the event's own `organizationId`
  instead of role elevation**: considered and rejected — the consumer's
  `PostgresUnitOfWork` would then need per-event construction
  (`new PostgresUnitOfWork(sql, event.organizationId)`), which is possible
  but adds a real footgun: `hasProcessed`/`markProcessed` against
  `platform.processed_events` (not itself an org-scoped table) would then
  run under a tenant-scoped role with no matching grant, reintroducing
  exactly the permission error this task's role-elevation design already
  fixed once (see this task's commit history: `hasProcessed` initially ran
  before elevation and failed with `permission denied for table
  processed_events`). Role elevation, once, covers both tables uniformly.

## Consequences

- `PostgresNotificationWorkItemRepository` is `@corestack/tenancy`'s first
  `GlobalRepository` — the guardrail ADR-0021 shipped with no consumer
  now has one, and it is exactly the case ADR-0021's own "Consequences"
  section anticipated ("any future repository that genuinely needs
  cross-tenant access").
- The fitness suite's real-repository check
  (`packages/architecture-tests/test/tenant-isolation.test.mjs`) passes
  against this file because it references both `GlobalRepository` and
  this ADR's `ADR-0026` citation.
- `tenancy.notification_work_items`' standard `tenancy_app`-facing RLS
  policies (SELECT/INSERT/UPDATE, org-scoped) remain unused by any
  current caller, kept only for forward-compatibility with a future
  request-scoped read (see `docs/modules/tenancy-notification-orchestration.md`) —
  this ADR does not weaken or bypass those policies for any role other
  than the one the consumer explicitly elevates to.
