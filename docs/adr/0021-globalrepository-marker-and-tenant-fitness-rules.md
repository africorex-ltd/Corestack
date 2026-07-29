# ADR 0021: `GlobalRepository` marker + tenant-isolation architecture fitness rules

- **Status:** Accepted
- **Date:** 2026-07-29
- **Elaborated in:** [Architecture §20](../architecture/ARCHITECTURE.md) (pooled multi-tenancy), [tenant-isolation-certification.md §5](../security/tenant-isolation-certification.md)

## Context

The Tenant Isolation Certification review commissioned permanent
architecture-fitness enforcement so that a future repository accidentally
omitting org scoping, or a future SQL helper reaching into
`platform`-owned tables outside an approved adapter, fails CI rather than
waiting for code review to catch it. No `GlobalRepository` concept existed
in this codebase before this review — grepped directly, zero matches,
no ADR.

The existing architecture-fitness tooling
(`packages/architecture-tests/test/helpers.mjs`) is deliberately a
lightweight, zero-dependency regex/text-based scanner — it extracts import
specifiers and reads `package.json` manifests, not a real AST/type
analyzer. This bounds what can be mechanically enforced: detecting "this
class implements interface X" or "this method's parameter list includes
an org-scoped type" by name-matching source text is approximate, not a
type-level guarantee. Two of the five rules requested in the
certification (an unscoped-query-method detector, and a "purge handler
omits organizationId extraction" detector) require call-site/signature
semantics this tooling doesn't have — implementing them as text-pattern
rules risks the exact failure mode the certification review itself warned
against: "a fitness test that pattern-matches source text and silently
passes on a renamed variable is worse than no rule."

## Decision

**`GlobalRepository` is added to `@corestack/platform`** as a minimal
marker interface (`src/application/global-repository.ts`), exported from
the package's main entry point:

```ts
export interface GlobalRepository {
  readonly __globalRepository: true;
}
```

A brand property (not an empty interface) prevents an unrelated
zero-member type from structurally satisfying it by accident.

**Three of the five requested rules are implemented as automated
architecture-fitness tests** (`packages/architecture-tests/test/tenant-isolation.test.mjs`),
each with a pure, independently-testable rule-checking function proven
against both the real repository and synthetic violating/passing fixtures
(never assumed to fire — verified):

1. Every `*repository*.ts` source file must reference either
   `OrgScopedContext` (proving at least one org-scoped touchpoint) or
   `GlobalRepository` (an explicit opt-out).
2. Any file referencing `GlobalRepository` must also cite an `ADR-####`
   pattern in the same file — an undocumented global repository fails the
   rule exactly as an unscoped one would.
3. No source file outside `packages/*/src/infrastructure/**` (or test/
   test-support directories) may reference a `platform.<table>`
   schema-qualified name directly — SQL access to platform-owned tables
   is confined to approved adapters.

**Two requested rules are downgraded to a documented review checklist,
not a fitness test**, with the reasoning stated explicitly rather than
silently skipped:

4. _"No event consumer may be registered without an explicit consumer
   name"_ — detecting "was a consumer name explicitly passed at this call
   site" requires call-argument analysis this tooling doesn't perform.
   A regex matching `registerPurgeHandler\(` calls and checking the first
   argument isn't a string literal would be trivially defeated by any
   indirection (a variable, a template literal, a helper function) and
   would give false confidence. Documented in the certification's
   Contributor Safety Guide as a required review-checklist item instead.
5. _"No purge handler may omit `organizationId` extraction"_ — this is
   **already enforced at runtime**: `registerPurgeHandler` itself throws
   `ValidationError` if `event.organizationId === null`, before ever
   invoking the module's handler (existing `purge-protocol.test.ts`
   coverage). A static-analysis fitness rule here would duplicate an
   already-stronger runtime guarantee, not add coverage.

## Alternatives considered

- **Implement all five rules as best-effort text patterns anyway**:
  rejected — a rule that can be silently defeated by a rename or a level
  of indirection creates false confidence, which the certification review
  explicitly identified as worse than no rule at all.
- **Build a real AST parser (e.g. via TypeScript's compiler API) to make
  all five rules exact**: rejected as disproportionate for this review —
  `helpers.mjs`'s zero-dependency, plain-regex design is itself a
  deliberate choice (documented in its own header comment: "a custom
  40-line walker beats a dependency in the package whose job is guarding
  dependencies"). Introducing a full type-checker into the fitness suite
  is a larger architectural change than this review's scope, and the two
  downgraded rules already have a stronger enforcement mechanism (rule 5)
  or an acceptable review-checklist substitute (rule 4).

## Consequences

- `@corestack/platform`'s public surface grows by one marker type
  (`GlobalRepository`) with no runtime behavior — a pure compile-time/
  grep-time signal.
- `packages/architecture-tests` gains a new test file enforcing three
  rules against the real repository, each also proven against a synthetic
  violating fixture and a synthetic passing fixture — so the rule's
  actual firing behavior is regression-tested, not assumed.
- Any future repository that genuinely needs cross-tenant access must
  implement `GlobalRepository` and cite the ADR that approved it in the
  same file, or the fitness suite fails CI. Today, zero repositories in
  this codebase need it — `FixtureWidgetRepository` (T31) is already
  org-scoped — so this ships as a guardrail with no current consumer, a
  deliberate exception to this codebase's usual "no scaffolding without a
  consumer" discipline, justified because it is cheap (one interface,
  one fitness rule) and closes a real, requested security-review gap
  rather than speculating about a future feature.
