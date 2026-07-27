# Engineering Blueprint — M4: Reference Application & Documentation

Epics E17 (Reference Application), E18 (Documentation). Standards:
[00-OVERVIEW.md](00-OVERVIEW.md). The reference app and docs site are M4 exit
criteria and the vision's primary adoption funnel (first-hour DX).

---

## E17 — Reference Application `apps/reference-nextjs` (M4, 20 tasks, ~30d)

**Goal:** a deployed, public Next.js application composing every module —
living documentation, E2E substrate, and load-test target. Never published to
npm; always deployable from `main`.

### F17.1 Application Shell

| ID      | Task — Description                                                                                                                                                    | Cat | Pri | Deps             | Cx/Est | Acceptance criteria & subtasks                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E17-T01 | App scaffold — Next.js App Router + CoreStack composition root (all modules), env config, `web`/`worker` roles                                                        | APP | P0  | E14-T20, E15-T04 | M/2d   | Boots via `corestack init`-equivalent path (dogfooding); doctor passes                                                                                 |
| E17-T02 | Auth UI flows — register/verify/login/MFA/password reset/OAuth pages against the API                                                                                  | APP | P0  | T01              | L/4d   | Every auth error code has a UX state (no dead ends); cookie+CSRF wiring via SDK. Sub: .1 register/verify; .2 login+MFA; .3 reset; .4 OAuth             |
| E17-T03 | Org UX — org switcher, create org, settings, member list/invite/roles UI                                                                                              | APP | P0  | T02              | L/4d   | Invitation full loop incl. invited-before-registration; permission-gated UI via my-permissions ETag flow. Sub: .1 switcher; .2 members; .3 invitations |
| E17-T04 | Role management UI — role editor over rbac endpoints (catalog-driven), custom-roles entitlement gate visible                                                          | APP | P1  | T03              | M/2d   | Grants⊆own enforcement surfaces correctly in UX                                                                                                        |
| E17-T05 | Billing UX — plan picker, checkout redirect, subscription state, portal link, entitlement-gated feature demo                                                          | APP | P0  | T03              | L/3d   | Dunning/past-due states rendered; the gated demo feature makes entitlements tangible                                                                   |
| E17-T06 | Notifications UX — inbox with badge, preferences matrix                                                                                                               | APP | P1  | T02              | M/2d   | Security category shown locked                                                                                                                         |
| E17-T07 | Webhooks + API keys settings UX — endpoint CRUD with delivery log viewer; key create (one-render UX pattern)                                                          | APP | P1  | T03              | M/2d   | One-render modals handle copy-once correctly                                                                                                           |
| E17-T08 | Audit trail UX — org timeline with filters + FTS                                                                                                                      | APP | P1  | T03              | M/2d   | Cursor infinite scroll via SDK iterate()                                                                                                               |
| E17-T09 | File upload demo — avatar/attachment via signed-URL handshake                                                                                                         | APP | P2  | T01              | S/1d   | Handshake states (pending/complete/failed) visible                                                                                                     |
| E17-T10 | Adopter-domain sample feature — a small "projects" resource demonstrating adopter code beside CoreStack (permissions registered, events audited, entitlement-limited) | APP | P0  | T04, T05         | L/3d   | The teaching artifact: shows the adopter seam end-to-end; heavily commented. Sub: .1 domain sample; .2 permission registration; .3 UI                  |

### F17.2 Operations

| ID      | Task — Description                                                                                           | Cat | Pri | Deps | Cx/Est | Acceptance criteria & subtasks                                               |
| ------- | ------------------------------------------------------------------------------------------------------------ | --- | --- | ---- | ------ | ---------------------------------------------------------------------------- |
| E17-T11 | Reference Dockerfile — multi-stage, non-root, read-only fs, healthcheck, SBOM (Architecture §37)             | INF | P0  | T01  | M/2d   | Image builds in CI; hadolint clean; both roles run                           |
| E17-T12 | `docker-compose.dev.yml` — pg + mailcatcher + MinIO one-command dev stack (Architecture §37)                 | INF | P0  | T01  | S/1d   | `compose up` → app boots migrated+seeded < 5 min                             |
| E17-T13 | Public deployment — reference app live (managed pg + Fly/CloudRun-class host), demo-mode data resets nightly | INF | P0  | T11  | M/2d   | Public URL; reset job; abuse limits tightened                                |
| E17-T14 | OTel wiring demo — traces/metrics exported to a public-viewable dashboard (Architecture §31)                 | INF | P1  | T13  | M/2d   | Golden signals visible; linked from docs                                     |
| E17-T15 | Helm chart example — documentation-grade chart per Architecture §38                                          | INF | P2  | T11  | M/2d   | Deploys to kind in CI (example-verify lane); "example, not product" labeling |
| E17-T16 | Terraform examples — one target (AWS ECS+RDS) first (Architecture §39)                                       | INF | P2  | T11  | M/2d   | Plan validates in CI; README caveats                                         |

### F17.3 Verification

| ID      | Task — Description                                                                                            | Cat | Pri | Deps         | Cx/Est  | Acceptance criteria & subtasks                                  |
| ------- | ------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------- | --------------------------------------------------------------- |
| E17-T17 | Playwright E2E — golden journeys through the real UI (browser layer of E14-T26)                               | TST | P0  | T02–T08      | L/3d    | Journeys green in CI against compose stack                      |
| E17-T18 | k6 load-test profile — journey mix, per-release run, published numbers (Architecture §43)                     | TST | P1  | T13          | M/2d    | Baseline recorded; regression alert threshold                   |
| E17-T19 | First-hour DX validation — scripted naive-reader walkthrough: clone→compose→working app, timed (vision NFR-6) | TST | P0  | T12, E18-T03 | S/1d    | < 1 h by someone outside the team; friction log filed as issues |
| E17-T20 | Reference app maintenance policy — always-green-on-main rule, update cadence with module releases             | DOC | P1  | T13          | XS/0.5d | Policy in app README; CI enforces build-on-module-change        |

---

## E18 — Documentation & Docs Site (M4, 22 tasks, ~32d)

**Goal:** docs as the front door and competitive weapon (vision §17). Site:
Starlight/Astro (Architecture §10).

### F18.1 Site Infrastructure

| ID      | Task — Description                                                                                                                  | Cat | Pri | Deps | Cx/Est | Acceptance criteria & subtasks                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ---- | ------ | ------------------------------------------------------------ |
| E18-T01 | Docs site scaffold — Starlight setup in `docs-site/`, IA per T02, search, dark mode, versioning strategy                            | INF | P0  | —    | M/2d   | Site builds+deploys on merge; Lighthouse ≥ 95                |
| E18-T02 | Information architecture — top-level IA: Get Started / Guides / Modules / Reference / Architecture / Community; navigation contract | DOC | P0  | —    | S/1d   | IA review against 5 persona journeys (vision §8)             |
| E18-T03 | Code-sample CI — every doc sample extracted + type-checked/run in CI (category-DOC standard's enforcement arm)                      | INF | P0  | T01  | M/2d   | Broken sample fails docs build; samples import real packages |
| E18-T04 | Link + freshness checks — dead-link gate; per-page last-verified metadata with staleness report                                     | INF | P1  | T01  | S/1d   | Nightly staleness report issue                               |

### F18.2 Adoption Funnel

| ID      | Task — Description                                                                                                           | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | ----------------------------------------------------------------------------------------------------- |
| E18-T05 | Quickstart — zero→authenticated multi-tenant app, the < 1 h artifact (vision NFR-6)                                          | DOC | P0  | T03, E15-T04 | L/3d   | Timed validation (E17-T19); every step copy-pasteable; failure-mode boxes for the top doctor findings |
| E18-T06 | "How CoreStack thinks" — concepts guide: modules, ports/adapters, events, Result, tenancy model — the mental-model page      | DOC | P0  | T02          | M/2d   | Reviewed for no-jargon-without-definition; diagrams                                                   |
| E18-T07 | Incremental adoption guide — CoreStack beside an existing app (the Daniel persona path): auth-first and tenancy-first routes | DOC | P0  | T06          | L/3d   | Both routes worked end-to-end with a sample legacy stub                                               |
| E18-T08 | Framework guides — Next.js and Hono/Node integration guides                                                                  | DOC | P0  | T05          | M/2d   | Both build on sample CI                                                                               |
| E18-T09 | Deployment guides — VPS/compose, Fly/CloudRun-class, k8s (chart pointer), env/secrets checklist                              | DOC | P1  | E17-T11..T16 | M/2d   | Each path smoke-verified once                                                                         |

### F18.3 Module & Reference Docs

| ID      | Task — Description                                                                                                                                         | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| E18-T10 | Module docs template + migration of E05–E13 module docs into the site — uniform structure (overview/glossary/quickstart/use-cases/config/adapters/testing) | DOC | P0  | T02     | L/4d   | All nine modules conform; template checklist gate for future modules. Sub: .1 template; .2 identity docs; .3 control-plane docs; .4 M3 docs |
| E18-T11 | API reference — generated endpoint pages (E14-T24) integrated with guides cross-links                                                                      | DOC | P0  | E14-T24 | M/2d   | Every endpoint page: example, error codes, permission                                                                                       |
| E18-T12 | Error-code registry page — generated from E14-T05 registry with remediation notes                                                                          | DOC | P0  | E14-T05 | S/1d   | Every code documented; problem `type` URLs resolve here                                                                                     |
| E18-T13 | Event catalog — generated from module event registries (E12-T17 generalized)                                                                               | DOC | P1  | E12-T17 | S/1d   | Versioned envelopes shown per event                                                                                                         |
| E18-T14 | Configuration reference — generated from module Zod config schemas                                                                                         | DOC | P1  | E03-T22 | M/2d   | Generated (drift-proof); secret fields marked                                                                                               |
| E18-T15 | Adapter authoring guide — port contracts, contract-suite lifecycle, community-adapter certification path (Architecture §24)                                | DOC | P0  | E04-T16 | M/2d   | A community author can ship an adapter with no maintainer contact (validated by external tester)                                            |

### F18.4 Operations & Security Docs

| ID      | Task — Description                                                                                             | Cat | Pri | Deps                 | Cx/Est | Acceptance criteria & subtasks                                 |
| ------- | -------------------------------------------------------------------------------------------------------------- | --- | --- | -------------------- | ------ | -------------------------------------------------------------- |
| E18-T16 | Runbook set — DR/restore (DB §19), upgrade (N/N+1 order), incident response, scaling ladder (DB §20)           | DOC | P0  | —                    | L/3d   | Each runbook rehearsed once; verify-restore references E15-T09 |
| E18-T17 | Security guide — threat-model summaries, secret rotation procedures per class, RLS posture, disclosure process | DOC | P0  | module threat models | M/2d   | Rotation procedures tested against reference app               |
| E18-T18 | Observability guide — OTel setup, golden-signal dashboards, correlation-id querying (Architecture §30–32)      | DOC | P1  | E17-T14              | M/2d   | Dashboard JSON downloadable                                    |
| E18-T19 | Performance guide — budgets, published load numbers (E17-T18), pooling/partitioning guidance                   | DOC | P2  | E17-T18              | S/1d   | Numbers auto-updated per release                               |

### F18.5 Meta

| ID      | Task — Description                                                                                    | Cat | Pri | Deps | Cx/Est | Acceptance criteria & subtasks                                      |
| ------- | ----------------------------------------------------------------------------------------------------- | --- | --- | ---- | ------ | ------------------------------------------------------------------- |
| E18-T20 | Docs analytics + feedback — privacy-respecting page feedback ("was this helpful"), search-miss report | INF | P2  | T01  | S/1d   | Feedback flows to triage; no invasive tracking (vision §18 posture) |
| E18-T21 | Versioned docs strategy — docs versions aligned to release trains; banner for 0.x                     | DOC | P1  | T01  | S/1d   | Version switcher live                                               |
| E18-T22 | Docs style guide — voice, structure rules, example conventions; enforced in docs review               | DOC | P1  | T02  | S/1d   | Checklist in PR template for DOC tasks                              |
