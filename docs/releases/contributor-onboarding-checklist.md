# Contributor Onboarding Checklist

- **Effort:** E05 Readiness Gate, Section 6.
- **Audience:** a new contributor's first day on CoreStack, before writing
  any code.

## Environment

- [ ] Node.js ≥ 20.11
- [ ] pnpm installed (repo uses pnpm workspaces + Turborepo)
- [ ] A local PostgreSQL 18 (16+ also verified compatible) reachable via
      `DATABASE_URL` — **or** a working Docker daemon for the
      Testcontainers fallback. Neither is optional: every integration
      test in this repo needs one or the other. See
      [testcontainers-readiness.md](../testing/testcontainers-readiness.md)
      if only Docker is available and it's not currently working — that's
      a known, documented constraint on some development machines, not
      something to debug for hours.
- [ ] `pnpm install` at the repo root succeeds
- [ ] `pnpm -r build && pnpm -r typecheck` succeeds
- [ ] `pnpm --filter @corestack/kernel test` and
      `pnpm --filter @corestack/platform test` both pass (unit lane, no
      database needed)
- [ ] `DATABASE_URL=... pnpm --filter @corestack/platform test:integration`
      passes (proves your local Postgres/Testcontainers setup actually
      works, not just that the code compiles)

## Required reading, in order

1. `docs/architecture/ARCHITECTURE.md` — the system's actual design, not
   just a folder tour.
2. `CLAUDE.md` / `CONTRIBUTING.md` (repo root) — standing conventions.
3. **If your work touches tenant-owned data (almost everything does):**
   [docs/security/how-to-build-a-tenant-safe-feature.md](../security/how-to-build-a-tenant-safe-feature.md)
   is **mandatory**, not optional reading. Skipping it reproduces the
   exact residual risks the Tenant Isolation Certification ranked.
4. Read `examples/acme-crm-module` end to end — every file, including the
   README's "real gotchas found while building this" section. This is the
   golden path; when in doubt about how a step should look, this is the
   worked answer, not a suggestion.
5. **If you're adding a new adapter to an existing kernel/platform port:**
   [docs/contributing/how-to-add-a-new-adapter.md](../contributing/how-to-add-a-new-adapter.md).
6. **If you're building a new module from scratch:** there is currently
   **no single guide covering package creation through first booting
   module** — see
   [e05-readiness-friction-log.md](../engineering/e05-readiness-friction-log.md)'s
   step 1. Until that's closed, your best path is copying
   `examples/acme-crm-module`'s package layout by hand and adapting it.

## Before your first PR

- [ ] Understand this repo's empirical-verification discipline: a claim
      about Postgres behavior is checked directly before being coded
      against; a bug fix is verified failing against the pre-fix code
      before being trusted fixed. See `contract-governance.md`'s "Required
      evidence for behavior changes" for the exact standard.
- [ ] Run `pnpm -r lint` (repo root's `eslint .`) and fix everything it
      flags — the architecture-fitness rules
      (`packages/architecture-tests`) enforce real boundaries (layer
      zones, import cycles, tenant-isolation rules), not style
      preferences; a failure here usually means a genuine design
      violation, not a lint nit to suppress.
- [ ] If your PR touches a published package (`kernel`, `platform`), add a
      changeset (`pnpm changeset`) — **note:** this discipline exists in
      policy (`docs/engineering/09-release-versioning.md`) but has not
      been consistently followed in this repo's own history; only one
      changeset exists in `.changeset/` today for a much larger surface
      than currently ships. Do the right thing on your PR regardless of
      that backlog — see
      [maintainer-release-checklist.md](maintainer-release-checklist.md).
- [ ] Update the relevant CHANGELOG entry, component spec, and
      `docs/quality/dashboard.md` if your change affects test counts, ADR
      count, or certification status — this repo measures, never
      estimates, these numbers.
- [ ] If your change is security-relevant, it needs: a test, a documented
      rationale, an ADR (if behavioral), and a CHANGELOG entry under the
      `SECURITY (ADR-XXXX):` prefix convention — see any of ADR-0020,
      ADR-0021, or ADR-0022's entries as a template.

## Common first-week mistakes (already made and fixed once — don't repeat)

- Using a human-readable id (e.g. `SequentialIdGenerator("evt-")`) for
  anything that will actually persist to a real Postgres `uuid` column —
  fails `invalid input syntax for type uuid` the instant a real insert
  runs. Use `UuidGenerator` for anything integration-tested against
  Postgres.
- Calling `runOrgScopedQuery` from inside a `UnitOfWork.run()` callback —
  attempts to nest a transaction, fails loudly by design
  (`TransactionSql` has no `.begin()`). Use `ctx.sql` directly inside a
  `UnitOfWork` callback instead.
- Constructing infrastructure (a repository, a driver) directly inside an
  application-layer file instead of receiving it injected — the
  `examples/*` ESLint zone rule catches this the same way it's enforced
  in `packages/platform`, and it was caught for real in
  `acme-crm-module`'s own first draft.
