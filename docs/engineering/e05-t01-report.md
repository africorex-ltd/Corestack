# E05-T01 — Tenancy Module Scaffold: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T01 only. Do not implement the
  Organization aggregate yet." Sections 1–14 of that directive.
- **Verdict:** **Complete**, scaffold-only, exactly as scoped.

## What shipped

New `@corestack/tenancy` package (`packages/tenancy/`):

| Area | What exists |
| --- | --- |
| Manifest | `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` (first bare one in the repo), `LICENSE`, `README.md`, `CHANGELOG.md` |
| Source layout | `src/{domain,application,infrastructure,interface,testing}/`, each with a barrel `index.ts` |
| Domain | Placeholder record types only (`OrganizationRecord`, `MembershipRecord`, `InvitationRecord`) — explicitly marked as not the real aggregates |
| Module factory | `createTenancyModule(deps, config) => ModuleInstance` — lifecycle-conformant (verified via `checkModuleConformance`), registers a purge subscription, static `health()` |
| Repository ports | `OrganizationRepository`, `MembershipRepository`, `InvitationRepository` — interfaces only, no persistence |
| Event contracts | 6 event name constants + payload types (`organization.*`, `member.*`) — types only, no publishing |
| Config | `tenancyConfigSpec` (`ModuleConfigSpec<TenancyConfig>`), `withTenancyConfigDefaults`, `resolveTenancyConfig` |
| Migration | `migrations/tenancy/0001_create-schema.sql` (schema only) + a README naming the RLS-DDL bridge gap it defers to E05-T21 |
| Tests | 3 files, 8 assertions: compilation smoke test, module-registration test, export-surface snapshot test |

## Deliberately not built (per explicit scope)

- The `Organization`/`Membership`/`Invitation` aggregates and their
  invariants (name/slug rules, status machine, never-owner rule) — **E05-T02–T04**.
- Every command (`CreateOrganization`, `InviteMember`, …) — `TenancyUseCases`
  is `Record<string, never>`.
- Repository persistence (Postgres adapters) — **E05-T21–T23**.
- Real health signals and real purge logic (the purge handler **throws**
  rather than silently succeeding, so a purge is never marked complete
  without a real delete) — **E05-T13**.
- Table DDL and RLS — **E05-T21**.
- HTTP interface — **E05-T24–T25**.
- Adopter-facing test fixtures (the `./testing` subpath is declared and
  exported now, but its content is an empty, reserved barrel) — **E05-T28**.

## A confirmed finding, not simulated

Building `tenancyConfigSpec` (Section 5) hit a real platform-framework
limitation: `ModuleConfigSpec<T>.schema` is typed `ZodType<T>`, which
fixes the schema's Input and Output to the same `T`. Verified with an
isolated `tsc --noEmit --exactOptionalPropertyTypes` check (not assumed):
neither `.optional()` nor `z.coerce.number()` can satisfy that constraint
under this repo's `exactOptionalPropertyTypes: true` — only a fully
required, uncoerced schema (`acme-crm-module`'s exact precedent) type-checks.

Resolved module-locally, not by changing platform code: Tenancy's config
fields are required strings validated by regex; `withTenancyConfigDefaults`
supplies the documented defaults at the `EnvSource` layer; `resolveTenancyConfig`
converts to numbers after validation. The underlying platform-type question
(whether `ModuleConfigSpec<T>.schema`'s Input parameter should be relaxed,
since `loadModuleConfig` never actually uses it at runtime) is recorded as
a confirmed finding in
[e05-readiness-friction-log.md](e05-readiness-friction-log.md) for a future
platform-scoped task to decide deliberately.

## Quality gate

All green, repo-wide, re-run after the fix above:

- `pnpm -r build` — kernel, platform, tenancy, example module: all pass.
- `pnpm -r typecheck` — all pass.
- `eslint .` — zero findings.
- `pnpm -r test` — 469 tests across 60 files, all green (tenancy: 3 files / 8 tests).
- Architecture-fitness suite — 36 tests across 5 files (up from 31; tenancy
  picked up automatically by every fitness rule's dynamic `packages/*` scan,
  zero config changes needed).
- Export-surface snapshot — tenancy's `.` and `./testing` conditions both
  gated; `./testing` correctly snapshots `[]` (reserved, empty by design).

## Permanent policy (Section 13, adopted)

Every future module follows this ordering: lifecycle-first registration,
contract before implementation, repositories before persistence, events
before handlers, health before runtime, purge before data, docs before
behaviour, snapshots before release. `@corestack/tenancy`'s own build in
this task is the first instance, not just the statement of the policy.

## Next

**E05-T02: the `Organization` aggregate** (name/slug validation, `kind`,
the `active → suspended → pending_deletion → purged` status machine). Not
started. Per the founder directive's Section 15, work stops here pending
the next prompt.
