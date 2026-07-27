# CoreStack — Repository Structure & Tooling

- **Status:** Draft, awaiting founder approval
- **Date:** 2026-07-28
- **Depends on:** Architecture §9, §45–47; Blueprint E01
- **Scope:** the physical repository: folders, workspace/package layout, naming
  conventions, and every configuration file — with the reasoning. Business
  logic is out of scope; this is the vessel it ships in.

## 1. Folder Structure (repository root)

```
CoreStack/
├─ packages/            publishable @corestack/* packages (kernel today;
│                       modules land per blueprint schedule — folders are
│                       created when their epic starts, never speculatively)
├─ apps/                reference applications (never published) — README stub
│                       now; reference-nextjs lands in M4 (E17)
├─ tooling/             shared dev-config packages (tsconfig, eslint) +
│                       future contract-test kit & scripts — versioned like
│                       code because config drift is code drift
├─ examples/            documentation-grade deploy assets (compose/helm/
│                       terraform) — README stub now, content per E17-F17.2
├─ docs/                the documentation tree (see DOCUMENTATION-MAP.md)
├─ .github/             workflows, templates, CODEOWNERS
├─ .changeset/          release configuration (Changesets)
└─ root configs         package.json, pnpm-workspace.yaml, turbo.json,
                        tsconfig.base.json, eslint.config.mjs,
                        .editorconfig, .gitignore, .dockerignore,
                        docker-compose.dev.yml, renovate.json
                        (prettier config: @corestack/prettier-config via the
                        root "prettier" field — no loose .prettierrc)
```

**Decisions:**

- **No speculative module _code_ — but visible skeleton folders.** _(Amended
  2026-07-28 by founder decision.)_ Approved packages/apps/examples get a
  placeholder folder containing **only a purpose README** — no `package.json`,
  so they are inert to the workspace (pnpm/turbo ignore them) until their
  blueprint epic starts and the module template (E05-T29) stamps in real
  structure. The tree communicates the plan; the workspace stays honest about
  status. The original rule — no speculative _code_ — stands.
- **`tooling/` holds packages, not loose files.** Shared config consumed as
  workspace packages (`@corestack/tsconfig`, `@corestack/eslint-config`) gets
  versioning, review, and a single upgrade point — loose root-level config
  copies drift silently.
- **`apps/` and `examples/` exist now with README stubs** so the tree's shape
  is stable from day one (paths in docs never churn) while their content
  arrives on schedule.

## 2. Workspace Structure

`pnpm-workspace.yaml` globs: `packages/*`, `apps/*`, `tooling/*`.

- **pnpm + Turborepo** per ADR-0002. Turbo tasks: `build`, `test`,
  `test:integration`, `typecheck`, `lint` — `test:integration` is separate
  because it requires Docker and must be skippable locally (Architecture §9).
- **Single-version policy for the toolchain** (TypeScript, ESLint, Vitest,
  Prettier pinned at the root / tooling packages); runtime dependencies stay
  per-package. Enforced later by a drift-check script (E01-T01).
- **`workspace:` protocol** for all internal dependencies — impossible to
  accidentally depend on a stale published version during development.

## 3. Package Structure

Every publishable package follows Architecture §45 exactly (uniformity is the
feature). The kernel demonstrates the shape today:

```
packages/<name>/
├─ src/                 (modules add domain/ application/ infrastructure/ interface/)
├─ test/
├─ docs/                (modules: glossary.md, threat-model.md)
├─ package.json         exports map = the semver perimeter; "files": ["dist"]
├─ tsconfig.json        editor/typecheck view (extends @corestack/tsconfig/library)
└─ tsconfig.build.json  emit view (src only → dist/)
```

- **Two tsconfigs per package** because the typecheck view includes tests but
  must not emit, while the build view emits but must exclude tests — one file
  serving both produces either polluted dist or unchecked tests.
- **`sideEffects: false`** everywhere (tree-shaking); ESM-only exports maps
  with `types` first (ADR-0001).

## 4. Naming Conventions

| Thing              | Convention                                                                           | Why                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Packages           | `@corestack/<context>` singular concept names (`auth`, not `auths`/`authentication`) | terse, matches bounded-context names                                                                 |
| Files              | `kebab-case.ts` (`invite-member.ts`)                                                 | case-insensitive-filesystem safe (this repo is developed on Windows + Linux); matches use-case names |
| Classes/types      | `PascalCase`; interfaces un-prefixed (`Clock`, not `IClock`)                         | TS community norm; the `I` prefix is Hungarian residue                                               |
| Use-case files     | verb-noun (`invite-member.ts` exports `InviteMember`)                                | file ↔ use case ↔ operationId (`tenancy.inviteMember`) one mental model                              |
| Tests              | `<subject>.test.ts` beside intent in `test/` mirroring `src/`                        | discoverability; Vitest default                                                                      |
| Migrations         | `NNNN_verb-noun.sql` per module                                                      | ordered, greppable                                                                                   |
| Env vars           | `CORESTACK_<MODULE>_<KEY>`                                                           | collision-proof in adopter apps                                                                      |
| Branches / commits | per CONTRIBUTING.md (`feat/E05-T17-…`, Conventional Commits)                         | already normative                                                                                    |
| DB objects         | `snake_case`, plural tables (DB doc)                                                 | already normative                                                                                    |

## 5. Configuration Files — the register

| File                                       | Owns                                                                     | Key decisions                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` (root)                      | scripts, toolchain devDeps, `packageManager` pin, build-script allowlist | private; scripts are turbo passthroughs so CI and humans run identical entry points                                                                   |
| `pnpm-workspace.yaml`                      | workspace globs                                                          | includes `tooling/*`                                                                                                                                  |
| `turbo.json`                               | task graph & caching                                                     | `lint`/`typecheck` cacheable; `test:integration` non-cached (containers)                                                                              |
| `tsconfig.base.json`                       | → thin pointer extending `tooling/tsconfig/base.json`                    | root file kept for editor tooling that looks for it; **single source lives in the tooling package**                                                   |
| `tooling/tsconfig/*`                       | `base` (strictness), `library` (packages), `app` (apps)                  | max-strict flags are non-negotiable and centralized; packages choose a variant, never redefine flags                                                  |
| `eslint.config.mjs` (root)                 | flat config consuming `@corestack/eslint-config`                         | one lint entry for the whole repo                                                                                                                     |
| `tooling/eslint/index.mjs`                 | base rules + **layer-boundary enforcement**                              | the dependency rule as lint errors (domain imports nothing outer, no `node:*` in domain/application, no `console`); baseline now, hardened in E01-T02 |
| `.prettierrc.json` / `.editorconfig`       | formatting                                                               | Prettier owns style so ESLint owns _correctness_ — no overlap, no fights                                                                              |
| `vitest` config (per package)              | test runner                                                              | per-package config (kernel pattern); shared preset extracted when the second package lands — extracting a preset from one consumer is premature       |
| `.changeset/config.json`                   | release configuration                                                    | see §9                                                                                                                                                |
| `.github/workflows/*`                      | CI                                                                       | see §8                                                                                                                                                |
| `docker-compose.dev.yml` / `.dockerignore` | local dev stack                                                          | see §8                                                                                                                                                |
| `renovate.json`                            | dependency updates                                                       | grouped weekly; actions pinned (E01-T05 completes SHA-pinning)                                                                                        |
| `.github/CODEOWNERS`                       | review routing                                                           | security-critical paths → security rotation (placeholder team names until the org exists)                                                             |

## 6. Linting & Formatting

- **ESLint 9 flat config**, typescript-eslint recommended baseline. Deliberately
  **not** type-aware linting yet: type-aware rules triple lint time; the
  boundary rules and strict `tsc` already cover the highest-value checks.
  Revisit in E01-T02 with measurements.
- **Boundary rules are the point** (Architecture §4 "enforced, not vigilance"):
  per-directory `no-restricted-imports` zones — `src/domain/**` may not import
  application/infrastructure/interface or `node:*`; `src/application/**` may
  not import infrastructure/interface or `node:*`; `console` banned in `src`
  (Logger port exists for a reason).
- **Prettier owns formatting** (100 cols, double quotes, trailing commas) —
  checked in CI (`format:check`), auto-applied locally. No ESLint stylistic
  rules; two style authorities is one too many.

## 7. Testing Layout

Per Architecture §44: unit/application tests per package (`test/`, Vitest);
integration tests gated behind `test:integration` (Testcontainers, Docker
required); contract suites arrive with E04 as `tooling/contract-kit`. CI
budget rules (repo unit suite < 30 s) enforced from E04-T12.

## 8. CI & Docker

Three workflows now (blueprint E01 hardens them):

- **`ci.yml`** — PR + main: install → lint → typecheck → unit test → build,
  then an integration job with a Postgres 16 service container. Node 20 + 22
  matrix on the unit job (the LTS floor and current LTS). Concurrency-cancels
  superseded runs (CI minutes are money).
- **`security.yml`** — CodeQL (JS/TS) + `pnpm audit` on PR + weekly schedule.
- **`release.yml`** — Changesets action on `main`: opens/updates the Version
  PR; publish step runs only when the Version PR merges, with npm provenance
  (`--provenance`) — **CI is the only publish path** (id-token permission,
  no human tokens).
- **`docker-compose.dev.yml`** — Postgres 16 (the only required service) plus
  optional profiles for mailcatcher/MinIO/Redis (`--profile full`) so day-one
  dev needs exactly `docker compose up` and nothing it doesn't use.
  Reference-app Dockerfile deliberately absent until E17 (nothing to build).

## 9. GitHub & Release Configuration

- **GitHub:** issue forms, PR template (already in place), CODEOWNERS,
  Renovate config. Branch protection/merge queue are _server-side_ settings
  applied at repo creation per [08-github-project.md](08-github-project.md) §1.
- **Release:** Changesets with `access: public`, `main` as base branch,
  independent versioning (no linked/fixed groups — the compatibility table is
  the coupling contract, not lockstep versions). `@corestack/*` tooling and
  apps are `privatePackages`-ignored. Changelog generation uses the GitHub
  changelog preset (PR links in changelogs) once the remote exists; plain
  preset until then.

## 10. What is deliberately absent

- **Husky/git hooks:** CI is the gate; local hooks that duplicate CI annoy
  contributors and get `--no-verify`'d. `simple-git-hooks` may be revisited
  for changeset reminders only.
- **Dual root README/docs duplication, wiki, `src/` at root, `develop`
  branch, per-adapter packages:** all rejected earlier with reasons
  (DOCUMENTATION-MAP, CONTRIBUTING, Architecture §7).
- **jest/babel/webpack artifacts:** the toolchain is TS + Vitest + tsc; no
  legacy compat layers.
