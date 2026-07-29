# `@corestack/example-acme-crm-module`

The canonical golden-path example for
[docs/security/how-to-build-a-tenant-safe-feature.md](../../docs/security/how-to-build-a-tenant-safe-feature.md).
Every tenant-isolation touchpoint this codebase has is wired together
here, end to end, against real PostgreSQL 18 — no shortcuts, no mocked
Postgres behavior. This module defines the quality bar for a real
CoreStack module; when in doubt about how a step of the contributor guide
should look in practice, read the code here before improvising.

It implements one narrow, real feature: create and list CRM contacts for
an organization, with a welcome-email side effect and organization-purge
support — small enough to read in one sitting, but touching every layer a
much bigger module would.

## What's here, mapped to the ten-step guide

| Step                                          | Where                                                                                                                                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Resolve context                            | Not this module's job — the composition script/interface binding calls `resolveContext` before ever calling a use case here. This module's use cases take an already-resolved `Context`.                                                  |
| 2. Open a `UnitOfWork`                        | `src/application/create-contact.ts` — `deps.uow.run(...)`, a `PostgresUnitOfWork`                                                                                                                                                         |
| 3. Set org context                            | Handled by `PostgresUnitOfWork` (write path) and `runOrgScopedQuery` (read path) — see "Two different transactional shapes" below                                                                                                         |
| 4. Use an org-scoped repository               | `src/application/contact-repository.ts` (port) + `src/infrastructure/postgres-contact-repository.ts` (adapter)                                                                                                                            |
| 5. Publish events                             | `create-contact.ts`'s `ctx.publish(...)` inside the `UnitOfWork` callback                                                                                                                                                                 |
| 6. Register an event consumer / purge handler | `src/application/module.ts` — the welcome consumer (`idempotentHandler`) and `registerPurgeHandler`                                                                                                                                       |
| 7. Add an RLS migration                       | `migrations/acme-crm/0001_create-contacts.sql`                                                                                                                                                                                            |
| 8. Add integration tests                      | `test/integration/acme-crm-module.postgres.test.ts` — isolation both directions, atomic commit, idempotent redelivery, purge                                                                                                              |
| 9. Add architecture-fitness coverage          | Nothing new needed — this module's own `*-repository.ts` file and its lack of direct `platform.*` access are already checked by `packages/architecture-tests/test/tenant-isolation.test.mjs` (ADR-0021), which now scans `examples/*` too |
| 10. Security review note                      | See "Security review note" at the bottom of this README                                                                                                                                                                                   |

## Two different transactional shapes — the subtlety worth understanding

`ContactRepository.create` and `.list` deliberately don't share a
transactional pattern:

- **`create`** takes the open transaction's own `TransactionSql`
  (`ctx.sql` from inside `PostgresUnitOfWork.run()`) directly. It must
  never call `runOrgScopedQuery` itself — that would attempt to nest a
  second transaction, which fails loudly (`TransactionSql` has no
  `.begin()` — proven by the Tenant Isolation Certification's
  nested-`UnitOfWork` regression test). The enclosing `UnitOfWork` has
  already set `app.current_org` for the whole transaction; `create` relies
  on that.
- **`list`** is a standalone read with no enclosing transaction, so it
  opens and org-scopes its own via `runOrgScopedQuery`.

Getting this backwards — calling `runOrgScopedQuery` from inside a
`UnitOfWork.run()` callback — is exactly the mistake step 2 of the
contributor guide warns about.

## Real gotchas found while building this (kept, not smoothed over)

- **The app role needs `INSERT` on `platform.outbox`, not just this
  module's own tables.** `PostgresUnitOfWork.run()` writes staged events
  into `platform.outbox` using the same connection the use case runs on —
  if that connection is authenticated as this module's restricted app
  role (the realistic production shape), the role needs that grant too,
  or every event-publishing write fails with "permission denied for
  schema platform." See `src/infrastructure/ensure-acme-crm-roles.ts`.
- **A role must exist before a migration's `CREATE POLICY ... TO role`
  statement can reference it.** Postgres has no `CREATE ROLE IF NOT
EXISTS`, and there's no hook in the migration-file format (T01) for
  "run this role-creation step first." `ensureAcmeCrmRoles(sql)` must run
  before `runMigrations` — see the composition order in the integration
  test's `beforeAll`.
- **Proving RLS isolation requires a genuinely authenticated app-role
  connection, not a superuser pool.** A Postgres superuser bypasses RLS
  entirely regardless of `FORCE ROW LEVEL SECURITY` — testing isolation
  against the same pooled superuser connection every other bootstrap step
  uses would pass even with RLS completely broken. This is why the
  integration test grants a temporary login password and connects
  separately as `acme_crm_app`, mirroring E03-T31's own harness.
- **Entity ids must be real UUIDs, not a readable `SequentialIdGenerator`
  sequence.** `contacts.id` and `contacts.organization_id` are `uuid`
  columns; an `IdGenerator` chosen for human-readable correlation ids
  (like `SequentialIdGenerator("corr-")`, useful in pure unit tests) fails
  `::uuid` casts the moment a real insert runs. Use `UuidGenerator` for
  any id a Postgres integration test will actually persist.

## Running this example's own tests

```bash
pnpm --filter @corestack/example-acme-crm-module test
DATABASE_URL=postgres://... pnpm --filter @corestack/example-acme-crm-module test:integration
```

The integration test creates its own disposable scratch database (same
`CREATE DATABASE` / `DROP DATABASE ... WITH (FORCE)` pattern as every
other package in this monorepo) — it never touches a shared database.

## Security review note (step 10, demonstrated)

This module touches two tenant-owned tables (`acme_crm.contacts`,
`acme_crm.welcome_log`), both RLS-enabled with the standard
`tenant_isolation`/`platform_full_access` policy pair — no
`GlobalRepository` usage anywhere. `PostgresContactRepository` is a
normal org-scoped repository (steps 4/9 above already cover its
architecture-fitness compliance). The welcome consumer and purge handler
both extract `organizationId` from the event envelope before doing
anything tenant-scoped, never from payload data (step 6). No secrets are
handled by this module. This is the level of detail a real feature's PR
description should give a reviewer — see
[docs/security/how-to-build-a-tenant-safe-feature.md](../../docs/security/how-to-build-a-tenant-safe-feature.md)
step 10.
