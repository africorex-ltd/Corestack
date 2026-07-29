# Export Surface Audit

- **Effort:** E04 Consolidation and Release-Hardening Mode, Section 7.
- **Method:** every claim below was checked against current file contents
  — `package.json` exports maps, `dist/` output, `src/index.ts` barrels,
  README tables, and `CHANGELOG.md` — not recalled from prior session
  summaries.

## Package exports maps

| Package | Condition | Types file | Import file | Both resolve on disk? |
| --- | --- | --- | --- | --- |
| `@corestack/kernel` | `.` | `dist/index.d.ts` | `dist/index.js` | Yes |
| `@corestack/kernel` | `./testing` | `dist/testing/index.d.ts` | `dist/testing/index.js` | Yes |
| `@corestack/platform` | `.` | `dist/index.d.ts` | `dist/index.js` | Yes |
| `@corestack/platform` | `./postgres` | `dist/postgres/index.d.ts` | `dist/postgres/index.js` | Yes |
| `@corestack/platform` | `./testing` | `dist/testing/index.d.ts` | `dist/testing/index.js` | Yes |

All five declared conditions across both packages resolve to real,
built files as of this audit (verified directly against a fresh `dist/`,
not assumed from the manifest). Both packages' `exports` maps declare
`types` before `import` in every condition — the ordering
`packages/architecture-tests`'s `manifest-rules.test.mjs` already enforces.

**Gap in the fitness rule itself, worth naming rather than silently
relying on manual verification:** `manifest-rules.test.mjs` checks
condition *ordering* (`types` first) but does not check that the files
those conditions point at actually exist after a build. A future PR that
adds a new subpath export and misspells or forgets to build its target
would pass this fitness rule and only fail at consumer-import time. This
is a real, if narrow, residual gap — not fixed here, since building an
existence check would mean either adding a build step to the fitness-test
pipeline (architecture-tests currently runs against source, not built
output) or accepting a check that only catches the problem post-build.
Recorded as a candidate for E04-T13 or a dedicated small follow-up, not
attempted here to avoid feature-creeping this audit into new tooling.

## Types-only exports

Every exported symbol in both packages' barrels is either a concrete
runtime value (class, function, const) or, when `export type` is used, a
type with no runtime representation at all (interfaces, type aliases). No
symbol is exported as a value in one barrel and only as a type in the
other, and no symbol is silently runtime-only where the port doc implies a
type should also be public. Spot-checked against `kernel/src/index.ts` and
`platform/src/index.ts` directly (both read in full for this audit).

## Accidental internal leaks

None found. Both barrels (`packages/kernel/src/index.ts`,
`packages/platform/src/index.ts`) export a curated, deliberate list —
neither uses a wildcard re-export (`export *`) anywhere, which is what
would make an accidental leak likely. Specifically checked and confirmed
**not** exported from either package's public surface:

- `packages/platform/test-support/test-database.ts`'s `createTestDatabase`/
  `withRole` — test infrastructure, correctly living outside `src/`
  entirely (not just excluded from the barrel).
- Internal Postgres connection/role-management helpers used by
  `PostgresUnitOfWork`, `PostgresRateLimiter`, etc. — none are re-exported
  standalone; only the adapter classes and their schema-bootstrap functions
  are public.
- `assertSafeSqlIdentifier` **is** exported from platform's main barrel
  (line 67 of `src/index.ts`) — deliberate, since it's a reusable guard a
  module author writing raw SQL would need (per
  `docs/security/how-to-build-a-tenant-safe-feature.md`), not an accidental
  leak.

## Deprecated symbols

None. A repository-wide search for `@deprecated` across every package's
`src/` directory returned zero matches. There is no deprecated surface to
audit for removal timing or migration guidance.

## Snapshot drift / export-surface gate coverage

This is the audit's most material finding, expanding on
`contract-coverage-audit.md`'s Residual Gap #2:

- **`@corestack/kernel`'s main entry (`.`)** is gated by
  `packages/kernel/test/api-surface.test.ts` — a single snapshot over
  `Object.keys(kernel).sort()`. This snapshot was correctly updated this
  session (via reviewed `vitest -u`) when `redactSensitiveFields`/
  `serializeErrorForLog` were added (ADR-0022).
- **`@corestack/kernel`'s `./testing` subpath has no equivalent gate.**
  All 8 contract-suite factory functions plus `SuiteHarness` are genuine
  public API (any module author building a new adapter is expected to
  import from here per `contract-governance.md`), but nothing would flag
  an accidental removal or rename the way the main entry's snapshot would.
- **`@corestack/platform` has no export-surface snapshot at all, for any
  of its three conditions.** Neither `.`, `./postgres`, nor `./testing` has
  a test analogous to kernel's `api-surface.test.ts`. This is a larger gap
  than the kernel one: platform's main barrel alone exports over 40 named
  symbols across migrations, outbox, health, tenancy, and purge — any of
  which could be accidentally renamed or dropped in a refactor with no
  automated signal beyond a downstream consumer's build breaking.

**Recommendation** (recorded here, not actioned in this pass, since adding
new test infrastructure is a scope decision beyond "audit what exists"):
add one `api-surface.test.ts`-style snapshot test per package per exported
condition — kernel needs one more (`./testing`), platform needs three
(`.`, `./postgres`, `./testing`). This is a small, mechanical addition that
directly closes the gap this audit identifies; a natural first task for
whoever picks up E04's next phase.

## Changelog consistency

Checked every CHANGELOG entry against the corresponding commit for this
session's work (T03–T09 contract suites, ADR-0022, the adapter-matrix
fitness rule, the four new performance baselines): all present, all under
the `[Unreleased]` section, in commit order. No user-visible change from
this session is missing a CHANGELOG entry.

## README consistency

Two stale entries were found and corrected as part of this audit (both
low-risk, factual corrections, not scope changes):

1. **`packages/kernel/package.json`'s `description` field** named
   "EventBus/Logger/Cache/RateLimiter/Encrypter/UnitOfWork ports" but
   omitted `ProcessedEventStore` and `IdempotencyStore`, both of which are
   real, shipped, exported ports (added in E03/E04, after the description
   was last written). Fixed to list all eight ports.
2. **`packages/platform/README.md`'s Architecture Scorecard** stated "191
   unit tests (no database) + 71 real-Postgres integration tests" — stale
   numbers from the E03 exit report. The dashboard's current measured
   counts (`docs/quality/dashboard.md`, re-verified via direct `vitest run`
   in the prior E04 session) are 194 unit / 97 integration. Fixed.

`packages/kernel/README.md`'s "Surface" table was already fully current —
it lists `ProcessedEventStore`/`idempotentHandler` and `IdempotencyStore`
correctly, and its own doc comment cross-references `test/api-surface.test.ts`
accurately. No changes needed there.

## Summary

| Check | Result |
| --- | --- |
| All declared export conditions resolve | Pass — 5/5 |
| Types-first ordering | Pass — enforced by fitness rule |
| Accidental internal leaks | None found |
| Deprecated symbols | None exist |
| Export-surface snapshot coverage | **Gap** — kernel's `./testing` and all of platform's three conditions are ungated (see Recommendation above) |
| CHANGELOG consistency | Pass — every session change entered |
| README consistency | 2 stale entries found and fixed (kernel package.json description, platform README test counts) |
