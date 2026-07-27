# CoreStack — Documentation Map

- **Status:** Draft, awaiting founder approval
- **Date:** 2026-07-28
- **Purpose:** the authoritative design of CoreStack's documentation: every
  document, its audience, its table of contents, what belongs in it, and its
  lifecycle. The docs-site IA (blueprint E18-T02) derives from this map.

## 1. Principles

1. **One source of truth per fact.** Design docs (architecture/database/api)
   own decisions; guides _teach_ those decisions and link back — they never
   restate normatively. Generated references (config, endpoints, error codes)
   are generated, never hand-maintained.
2. **Audience-first split:** _adopters_ (build on CoreStack), _contributors_
   (build CoreStack), _operators_ (run CoreStack apps). Every doc declares one
   primary audience.
3. **Structure precedes content.** Guides whose substance depends on
   implementation ship now as approved structures (TOC + per-section intent)
   with a status banner naming the milestone that fills them. An approved
   skeleton is a contract for writers and a review baseline.
4. **Root files are doors, not encyclopedias.** Repo-root docs (README,
   CONTRIBUTING…) stay short and route into `docs/`.

## 2. The Tree

```
/                         README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY,
                          GOVERNANCE, COMMUNITY, ROADMAP, CHANGELOG, LICENSE
docs/
  product/                VISION.md
  architecture/           ARCHITECTURE.md, DATABASE.md, API.md, overview.md
  adr/                    numbered ADRs + index
  rfc/                    numbered RFCs + process (E01-T19)
  guides/                 adopter guides: AUTHENTICATION, PERMISSIONS,
                          DEPLOYMENT, PLUGIN_DEVELOPMENT, THEMING, (grows: quickstart,
                          incremental adoption, module guides per E18)
  runbooks/               operator runbooks (DR, upgrade, incident, scaling; E18-T16)
  engineering/            blueprint 00–09 (internal)
  DOCUMENTATION-MAP.md    this file
packages/*/docs/          per-module glossary, threat model (contributor-facing)
packages/*/README.md      npm-facing package card
```

## 3. Document Register

Per document: **audience · owner · lifecycle · TOC & content charter.**
"Existing" = approved earlier this phase; charter listed for completeness.

### 3.1 Root documents

| Doc                    | Status          | Audience             | Charter (TOC → what belongs)                                                                                                                                                                                                                                                                                                    |
| ---------------------- | --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **README.md**          | existing        | first-touch adopters | Identity ("the third path" positioning) → Why (starter-kit/BaaS contrast) → Architecture-at-a-glance diagram → package table with status → dev quickstart → contributing/security/license pointers. _Belongs:_ the 90-second pitch and honest status. _Never:_ tutorials, API details, marketing superlatives without evidence. |
| **CONTRIBUTING.md**    | existing        | contributors         | Ground rules → getting started → workflow → branching → review policy → commit style. _Never:_ governance (links out), release mechanics (links out).                                                                                                                                                                           |
| **CODE_OF_CONDUCT.md** | **created now** | everyone             | Contributor Covenant 2.1 adapted: pledge → standards → enforcement responsibilities → scope → enforcement ladder → contacts. _Belongs:_ real named contact routes incl. the maintainer-conflict path (GOVERNANCE).                                                                                                              |
| **SECURITY.md**        | existing        | reporters            | Private reporting route → what to include → SLA (72 h ack, 7-day status) → scope → supported versions. Links the response runbook (E01-T13).                                                                                                                                                                                    |
| **GOVERNANCE.md**      | existing        | community            | Roles ladder → decision tracks (lazy consensus/RFC/ADR) → founder sunset clause → scope guardianship → conduct enforcement → asset continuity.                                                                                                                                                                                  |
| **COMMUNITY.md**       | **created now** | community            | Where to get help → where discussions happen → contribution ladder summary → recognition → cadence (devlog) → adapter registry pointer. _Belongs:_ every channel with its purpose and SLA. _Never:_ duplicate CONTRIBUTING content.                                                                                             |
| **ROADMAP.md**         | **created now** | adopters, community  | Current phase → milestone table with honest status → what's deliberately deferred (with links to the reasoned refusals) → how to influence (RFC). _Lifecycle:_ updated at every milestone close and devlog; dates are targets, revisions are public.                                                                            |
| **CHANGELOG.md**       | **created now** | adopters             | Platform-level release-train notes (cross-package highlights, breaking-change digest, upgrade pointers). Per-package detail lives in Changesets-generated `packages/*/CHANGELOG.md`; this file is the human digest.                                                                                                             |
| **LICENSE**            | existing        | everyone             | MIT, per ADR-0006.                                                                                                                                                                                                                                                                                                              |

### 3.2 Design documents (normative; contributors + evaluating architects)

| Doc                                   | Status   | Charter                                                                                                                             |
| ------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **docs/architecture/ARCHITECTURE.md** | existing | The 48-section system design; owns every architectural decision; changes via ADR only.                                              |
| **docs/architecture/DATABASE.md**     | existing | Complete schema design, global DB rules, migration/backup/scaling strategy; the source DDL is generated from during implementation. |
| **docs/architecture/API.md**          | existing | Complete HTTP surface + standards; the conformance suite (E14-T21) is its enforcement arm.                                          |
| **docs/adr/**                         | existing | One decision per file, immutable once accepted; index table.                                                                        |
| **docs/product/VISION.md**            | existing | The constitution: scope lists here override feature enthusiasm everywhere.                                                          |

### 3.3 Adopter guides (`docs/guides/`) — created now as approved structures

| Doc                       | Fills in                     | Charter summary (full TOC inside each file)                                                                                                                                                                                               |
| ------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AUTHENTICATION.md**     | M1                           | Teaching guide over the auth module: mental model, session vs API-key, flows (register→MFA→step-up), integration recipes, hardening checklist. Normative source: Architecture §16, API §3.                                                |
| **PERMISSIONS.md**        | M2                           | RBAC mental model, baseline vs custom roles, registering adopter permissions, guarding use cases, UI gating, debugging with the check endpoint. Source: Architecture §17–18, API §7.                                                      |
| **DEPLOYMENT.md**         | M4                           | Topologies (single node → ladder), env/secrets checklist, migrate-then-deploy contract, platform recipes (compose/Fly/k8s), health/observability wiring. Source: Architecture §35–41.                                                     |
| **PLUGIN_DEVELOPMENT.md** | M2 (adapters) / M4 (modules) | Extending CoreStack: adapter authoring against contract suites, event consumers, third-party modules (`/x/` namespace), certification. Source: Architecture §24.                                                                          |
| **THEMING.md**            | M4                           | **Scope-honest:** CoreStack is headless — this documents what _is_ themeable (email templates, reference-app design tokens) and the boundary (no UI kit, by vision §9). Exists so the #1 predictable question has an answer with reasons. |

### 3.4 Not in this map (deliberately)

- **Module guides, quickstart, incremental-adoption, runbooks** — chartered in
  blueprint E18 with their own tasks; they join the tree per that schedule.
- **Docs-site-only pages** (landing, comparison) — E18/E20 launch artifacts.
- **Wiki** — disabled; there is exactly one documentation tree.

## 4. Lifecycle & Quality Gates

- Every doc carries front-matter status (draft/approved/generated) + owner.
- DOC-category standards (blueprint §4) apply: samples type-checked in CI
  (E18-T03), link check, last-verified staleness metadata (E18-T04).
- A guide may not contradict a design doc; conflicts are bugs against the
  guide (or an ADR if the design is wrong).
- This map is itself versioned; structural changes to the tree go through it
  first.
