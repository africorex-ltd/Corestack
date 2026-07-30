# E05 Readiness Friction Log

- **Effort:** E05 Readiness Gate, Sections 2–3.
- **Method:** a dry-run walk of the 14 steps a contributor would take to
  build a new module, using only what exists today — no implementation
  work, no new tooling. Section 3's restricted view (only
  `examples/acme-crm-module`, `how-to-build-a-tenant-safe-feature.md`,
  `how-to-add-a-new-adapter.md`, `contract-governance.md`,
  `adapter-certification-matrix.md`) is folded in below as a distinct
  category per step, rather than written up twice — the two exercises
  overlap almost entirely.

## Severity key

- 🔴 **Blocking-grade friction** — a contributor cannot complete this step
  correctly without either reading source code directly or guessing.
- 🟡 **Real but survivable friction** — documented, but requires piecing
  together more than one doc, or copying from the one existing example
  by hand.
- 🟢 **No friction found** — a clear, sufficient path exists.

## The 14 steps

### 1. Create package 🔴

**No module scaffold generator exists anywhere in this repository.**
`tooling/scripts/` has exactly two scripts (`assert-turbo-tasks.mjs`,
`check-single-version.mjs`), neither of which scaffolds a package. There
is no `plop`, `hygen`, `turbo gen`, or equivalent. A contributor's only
path is to copy `examples/acme-crm-module`'s `package.json`,
`tsconfig.json`, `tsconfig.build.json`, and directory layout (`src/{domain,
application,infrastructure}`, `test/{domain,application,integration}`,
`migrations/<module-name>/`) by hand, then rename every internal reference
(package name, workspace deps, script names). Notably, `acme-crm-module`
itself has **no `vitest.config.ts`** — it relies entirely on `vitest` CLI
defaults, which a copier would only discover by noticing its absence, not
by being told.

E05-T01's blueprint row literally calls this scaffold "the documented
module template" — meaning the golden-path example **is** the intended
mechanism today, by hand-copying. This is the single highest-friction item
in this list, confirmed exactly where the advisor consultation for this
gate predicted it would be.

### 2. Register module 🟡

`createCoreStack({ eventBus, modules: { ... } })` is well-documented
(`create-core-stack.md`, `platform/README.md`'s usage sketch,
`create-core-stack.test.ts`) and mechanically simple: add a key to the
`modules` object. The friction is upstream of this step, not in it — see
step 1 (nothing hands a contributor a package to add) and step 3 below
(**no real composition root exists anywhere in this repository to add it
to**). `createCoreStack(...)` is called only inside its own
implementation file and its own test file, repo-wide — grepped directly to
confirm. `apps/reference-nextjs` (the eventual real app that would compose
every module) is an explicitly-planned placeholder (E17, M4), so this is a
**known, already-tracked gap**, not a new discovery — but it means "register
module" has never been proven against a real, booting process, only
against test fixtures.

### 3. Define config schema 🟡

`ModuleConfigSpec` + `loadModuleConfig`/`loadAllModuleConfigs` are
documented (`config-validation.md`) and the golden path defines one
(`acmeCrmConfigSpec` in `config.ts`). **But it is never actually invoked**
— grepped `acme-crm-module`'s own test files and found zero calls to
`loadModuleConfig`/`loadAllModuleConfigs` against `acmeCrmConfigSpec`
anywhere. The spec is declared and exported, but this module's own
env-mapping and validation behavior is unproven; only the generic
mechanism (in `config-validation.test.ts`, a different package) is tested.
A contributor copying the golden path would copy a config spec that has
never been exercised end-to-end in the one place that's supposed to show
them how.

### 4. Add migrations 🟢

`parseMigrationFile`'s header format, `FsMigrationSource`, and
`runMigrations` are clearly documented (`migration-loader.md`,
`migration-runner.md`) and the golden path's own migration
(`migrations/acme-crm/0001_create-contacts.sql`) is heavily commented,
explaining its own header fields and DDL choices inline. No friction found
here — this is the strongest-documented step in the walkthrough.

### 5. Create aggregate 🟢

Domain-layer entity/value-object construction (`src/domain/contact.ts`) is
plain TypeScript with no CoreStack-specific ceremony — a contributor's
existing DDD/TS knowledge transfers directly. No CoreStack-specific
friction.

### 6. Create repository 🔴 (real RLS-DDL automation gap, distinct from step 1)

The port/adapter split (`contact-repository.ts` port,
`postgres-contact-repository.ts` adapter) is clear and well-precedented.
The real friction is adjacent: **`buildTenantIsolationDdl()` exists
specifically to generate a table's RLS DDL programmatically, but nothing
bridges it to an actual migration file.** Migrations are static `.sql`
files parsed by `parseMigrationFile`; `buildTenantIsolationDdl()` returns
TypeScript string arrays. The golden path's own migration
(`0001_create-contacts.sql`) hand-transcribes RLS SQL that its own comment
admits is "exactly what `buildTenantIsolationDdl()` generates... written
out here as plain SQL because this migration runs through platform's real
migration engine, not as a one-off bootstrap script." Verified this by
reading both side by side — they match today, but nothing enforces that
they keep matching. A contributor's new module's RLS policy correctness
depends entirely on careful hand-copying with no automated cross-check
against the canonical generator function. This is a missing-automation
finding, not a missing-documentation one — the function that should
prevent this class of mistake exists and isn't used for its most obvious
purpose.

### 7. Apply RLS 🟢 (given step 6's caveat)

Once the DDL exists in a migration (however it got there), applying it is
just `runMigrations` — no additional friction beyond step 6's gap.

### 8. Publish events 🟢

`tx.publish(event)` inside a `UnitOfWork.run()` callback is simple and
consistent with `create-contact.ts`'s example. `createEvent()`'s envelope
construction is documented in the kernel README's events row.

### 9. Add purge handler 🟢

`registerPurgeHandler(moduleName, handler, store)` is a single, well-
documented call (`purge-protocol.md`, the golden path's own usage in
`module.ts`). No friction.

### 10. Register health checks 🟡

The golden path's `health()` returns a **hardcoded `{ status: "healthy" }`
stub** — it never actually checks anything (not the module's own tables,
not a dependency). This is a legitimate choice for a narrow example
(nothing in `acme-crm-module` has a plausible failure mode worth checking)
but it means **there is no worked example of a module implementing a
real, meaningful `health()`** — only the platform-level `checkReadiness`
(T23) demonstrates real health-signal computation, and that's a different
layer (composition-root readiness, not a single module's self-report). A
contributor building Tenancy, which will have real failure modes worth
signaling (e.g. an unreachable dependency), has no module-level precedent
to copy.

### 11. Add unit tests 🟢

`test/domain/contact.test.ts` and `test/application/create-contact.test.ts`
are small, clear, idiomatic vitest files. No CoreStack-specific friction.

### 12. Add integration tests 🟢

`test/integration/acme-crm-module.postgres.test.ts` is the single best-
documented file in the golden path — extensive inline comments explain
*why* each setup step exists (temporary login password, role-before-
migration ordering, real UUIDs). This is the model to copy, and it's clear
enough to copy from directly.

### 13. Add contract compliance 🟢 (not applicable here, correctly so)

`ContactRepository` is a one-off application-layer port specific to this
module, not a kernel port with multiple adapters — no contract suite
applies, and the golden path's own README says so explicitly (step 9 of
its ten-step guide: "nothing new needed"). This is the correct answer, not
a gap; flagging only so a future reader doesn't mistake the absence of a
contract suite here for an oversight.

### 14. Add documentation 🟡

No single doc walks steps 1–3 and 10 (package creation, module
registration into a real composition root, config-schema wiring,
meaningful health checks) — see those steps above. `how-to-build-a-
tenant-safe-feature.md` starts at "step 1: resolve context," which
assumes a package and use-case function already exist. Everything from
"empty directory" to "first use case ready to wire" has no guide; a
contributor's only resource is reading `acme-crm-module`'s source
end-to-end and inferring the pattern.

## Section 3 — golden-path-only validation (restricted-doc view)

Pretending to be a first-time external contributor restricted to exactly
the five named docs/example:

- **Missing:** how to create the package itself (none of the five
  documents this — `how-to-add-a-new-adapter.md` is scoped to kernel/
  platform *port adapters*, not application *modules*, and explicitly
  starts from "you have an adapter to build," same gap as step 1 above).
- **Missing:** how to register the new module's config with
  `loadAllModuleConfigs` at actual composition time — no document shows
  the full chain from raw env vars to a validated `AcmeCrmConfig` reaching
  `createAcmeCrmModule`.
- **Ambiguous:** `adapter-certification-matrix.md` and
  `contract-governance.md` are entirely about **kernel port** adapters
  (Cache, RateLimiter, etc.) — a contributor building a module-specific
  repository (like `ContactRepository`) could reasonably wonder whether
  they need to add a row to the matrix. They don't (it's not a kernel
  port), but nothing in these five documents says so explicitly; the
  answer currently lives only in the golden path's own README (step 9),
  which is outside this section's restricted doc set by construction —
  meaning a contributor following *only* the five named documents would
  hit this ambiguity for real.
- **Clear:** everything from "you have a use case function and a
  repository port" onward (steps 4–9, 11–13 above) is well-covered by
  `how-to-build-a-tenant-safe-feature.md`'s ten-step checklist plus the
  golden path's own code.

## Summary

| Severity | Count | Steps |
| --- | --- | --- |
| 🔴 Blocking-grade | 2 | Create package (1), RLS-DDL automation gap (6) |
| 🟡 Real but survivable | 4 | Register module (2, blocked upstream by 1/no live app), Define config schema (3), Register health checks (10), Add documentation (14) |
| 🟢 No friction found | 8 | Add migrations (4), Create aggregate (5), Apply RLS (7), Publish events (8), Add purge handler (9), Add unit tests (11), Add integration tests (12), Add contract compliance (13) |

**The two 🔴 items are the ones worth fixing before E05 starts, not
deferring:**

1. **No module scaffold.** E05-T01 (module scaffold, per the blueprint's
   own framing) is precisely positioned to close this — building the
   Tenancy module scaffold *as* the documented, copyable template is
   already E05's first task, not extra work.
2. **No RLS-DDL generation bridge.** `buildTenantIsolationDdl()` producing
   TypeScript strings with no path into a migration file is a real,
   fixable automation gap — either a small CLI/script that prints the DDL
   for a contributor to paste, or (more robust) a migration-authoring
   convention that imports and calls the function directly rather than
   transcribing its output. Worth a decision before Tenancy's own RLS
   migration is written, since Tenancy is exactly the kind of module where
   getting this DDL subtly wrong would be a real security issue, not a
   cosmetic one.

## Confirmed finding (not simulated): `ModuleConfigSpec` cannot express an
optional or coerced config field

Found while actually building `@corestack/tenancy`'s `tenancyConfigSpec`
(E05-T01, Section 5) — the first module to need a numeric, defaulted
config value, closing exactly the gap step 3 above predicted ("no doc
showed a module's config schema actually wired end-to-end"). This is an
empirical result, verified with an isolated `tsc --noEmit
--exactOptionalPropertyTypes` check against three schema shapes, not a
guess:

- `z.object({ a: z.string().optional() })` assigned to `ZodType<{ a?:
  string }>` — **fails.** Under `exactOptionalPropertyTypes: true`, an
  optional zod field's inferred type is `{ a?: string | undefined }`,
  which is not assignable to `{ a?: string }`.
- `z.object({ a: z.coerce.number().optional() })` assigned to `ZodType<{
  a?: number }>` — **fails**, same reason plus the `_input` mismatch
  coercion introduces (`unknown` vs the declared `number`).
- `z.object({ a: z.string() })` (required, no optional, no coerce) —
  **passes.** This is exactly `acme-crm-module`'s `welcomeMessage:
  z.string().min(1)` shape, which is why the one existing exercise of
  `ModuleConfigSpec` never hit this.

Root cause: `config-validation.ts`'s `ModuleConfigSpec<T>.schema` is typed
`ZodType<T>`, which defaults to `ZodType<T, ZodTypeDef, T>` — Input and
Output both fixed to `T`. `loadModuleConfig` always calls
`spec.schema.safeParse(raw)` where `raw: Record<string, unknown>` built
from raw env-var strings, so the schema's declared Input type has no
runtime effect — the constraint is stricter at compile time than the
framework needs at runtime, and it silently forecloses any field that
needs a default or a string→number conversion, which is most numeric
config in practice.

**Resolution applied (module-scoped, not a platform change):** Tenancy's
config fields are typed as required strings, validated with a
`z.string().regex(...)`, matching the one shape that actually
type-checks. Defaulting happens one layer out, via a
`withTenancyConfigDefaults(env: EnvSource): EnvSource` wrapper (falls back
to the documented default when a key is absent); numeric conversion
happens after validation, via `resolveTenancyConfig`. See
`packages/tenancy/src/application/config.ts` for the full implementation
and reasoning.

**Left open, on purpose:** whether `ModuleConfigSpec<T>.schema`'s type
should be relaxed (e.g. to `ZodType<T, ZodTypeDef, unknown>`, since Input
is never actually used at runtime) is a platform-level decision with its
own blast radius across every future module's config spec — out of scope
for a module scaffold task. Recorded here so the next module that hits
this doesn't have to re-derive it, and so a future platform task can
decide deliberately rather than by accretion.
