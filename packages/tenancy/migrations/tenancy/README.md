# Tenancy migrations

- `0001_*` — reserved by the E05-T01 scaffold placeholder (no tables).
- `0002_create-tenancy-tables.sql` (E05-T10) — creates
  `organizations`/`memberships`/`invitations`, with Row-Level Security
  enabled and forced from the same migration. See
  [docs/modules/tenancy-rls-design.md](../../../../docs/modules/tenancy-rls-design.md)
  for the full policy design and
  [ADR-0024](../../../../docs/adr/0024-tenancy-organizations-rls-direct-visibility.md)
  for the `organizations` visibility decision.

## History: the gap this migration closed

Earlier revisions of this README flagged two open questions and
attributed their resolution to a task named "E05-T21." Both were
actually resolved by **E05-T10**, not T21:

1. **`organizations`' RLS shape** — a row in `organizations` *is* an
   organization, not something merely scoped *to* one via
   `organization_id`, so the standard `buildTenantIsolationDdl` policy
   shape didn't apply verbatim. Resolved: direct (id-keyed) visibility —
   see ADR-0024.
2. **"RLS DDL is hand-transcribed today... nothing bridges
   `buildTenantIsolationDdl()`'s generator output into an actual `.sql`
   migration file."** Resolved for `organizations`/`memberships`/
   `invitations`: `0002_create-tenancy-tables.sql`'s `CREATE TABLE`
   statements were generated via `drizzle-kit generate` against the
   frozen E05-T09 Drizzle schema (used as a one-time generation aid, not
   a persistent dependency); its RLS/GRANT statements are hand-authored
   but verified byte-for-byte (whitespace-normalized) against
   `packages/tenancy/src/infrastructure/postgres/rls/`'s own generator
   functions via
   `test/infrastructure/migration-rls-consistency.test.ts`. The broader
   question of a *permanent*, on-every-schema-change generation pipeline
   remains open — this migration closes the gap for this one file, not
   the tooling gap in general.

## Migration-file contract

Every migration here follows `packages/platform/src/domain/
migration-file.ts`'s contract: a `@description`/`@lock-impact` header,
sequential versioning, validated by `parseMigrationFile`/
`loadMigrationSet`.
