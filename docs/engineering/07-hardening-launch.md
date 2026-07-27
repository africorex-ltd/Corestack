# Engineering Blueprint — M5: Hardening & Launch

Epics E19 (Security & Performance Hardening), E20 (Community & Launch).
Standards: [00-OVERVIEW.md](00-OVERVIEW.md). M5 exit = 1.0 for the identity
core + control plane, externally audited, publicly launched.

---

## E19 — Security & Performance Hardening (M5, 22 tasks, ~36d)

**Goal:** convert "secure by default" from claim to evidence: external audit,
API freeze, upgrade contract in CI, published performance numbers.

### F19.1 External Audit

| ID      | Task — Description                                                                                                                  | Cat | Pri | Deps    | Cx/Est                    | Acceptance criteria & subtasks                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| E19-T01 | Audit scoping & vendor selection — scope: auth, tenancy, rbac, platform (outbox/RLS), HTTP layer; select firm with OSS track record | SEC | P0  | M4 exit | M/2d                      | Scope doc + contract; budget approved by founder                                                                                                     |
| E19-T02 | Pre-audit self-assessment — ASVS L2 checklist full pass, threat-model review refresh across modules, known-gap register             | SEC | P0  | T01     | L/4d                      | Gap register triaged; criticals fixed pre-audit (don't pay auditors to find known issues). Sub: .1 ASVS sweep; .2 threat-model refresh; .3 gap fixes |
| E19-T03 | Audit support & remediation — finding intake, fix PRs, retest coordination                                                          | SEC | P0  | T02     | XL/8d (split on findings) | All high/critical findings closed + retested; report summary publishable. Sub: .1 triage; .2 remediation waves; .3 retest                            |
| E19-T04 | Public audit summary — findings/remediations published (trust artifact, vision §16 transparency)                                    | DOC | P1  | T03     | S/1d                      | Published with launch                                                                                                                                |

### F19.2 Adversarial Depth

| ID      | Task — Description                                                                                                                                         | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------ | -------------------------------------------------------------------------------------- |
| E19-T05 | Cross-module attack-chain exercises — invitation→privilege chains, webhook→SSRF pivots, billing→entitlement races (attacker mindset over the composed app) | SEC | P0  | M4 exit | L/4d   | ≥ 12 chains attempted, documented, all closed or accepted-with-rationale               |
| E19-T06 | Dependency posture review — tree audit, unused-dep purge, pin policy verification, kernel-zero-deps recheck                                                | SEC | P0  | —       | M/2d   | Dep count per package published; justifications current                                |
| E19-T07 | Secrets-flow audit — trace every secret class issuance→storage→use→rotation→revocation against docs                                                        | SEC | P0  | —       | M/2d   | Flow diagrams verified against code; deviations fixed                                  |
| E19-T08 | DoS-resilience pass — payload bombs, pagination abuse, expensive-query probes, rate-limit coverage matrix                                                  | SEC | P1  | —       | M/2d   | Coverage matrix: every unauthenticated endpoint limited; worst-case query cost bounded |
| E19-T09 | Isolation suite external red-team review — an outside reviewer attempts to find use cases the suite misses                                                 | SEC | P1  | T05     | M/2d   | Misses become permanent suite cases                                                    |

### F19.3 Performance Certification

| ID      | Task — Description                                                                                                                                  | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------ | ------------------------------------------------------------------- |
| E19-T10 | Budget certification — session-validation & policy-check ≤ 5 ms p95, use-case overhead ≤ 2 ms p95 verified on reference hardware (Architecture §43) | TST | P0  | E04-T13 | M/2d   | Numbers published; regression gates tightened to certified baseline |
| E19-T11 | Load-test certification — k6 profiles at 3 scaling-ladder rungs (1-node, 3-node, +Redis) with published results                                     | TST | P0  | E17-T18 | L/3d   | Docs performance page updated with reproducible harness             |
| E19-T12 | Query-plan audit — explain-plan review of every hot-path query against DB-doc indexes; N+1 sweep of adapters                                        | ADP | P0  | —       | M/2d   | Every hot query uses its intended index; findings fixed             |
| E19-T13 | Soak test — 72 h sustained load: leak detection (memory/connections/partition growth), relay/queue lag stability                                    | TST | P1  | T11     | M/2d   | No unbounded growth; lag stable                                     |

### F19.4 Stability Contract

| ID      | Task — Description                                                                                                                                             | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| E19-T14 | API freeze review — full stable-surface review (exports, DTOs, events, error codes, endpoints) against semver commitments; deprecate-or-commit every `preview` | REL | P0  | T03     | L/4d   | Freeze report signed off; preview items resolved. Sub: .1 package surfaces; .2 HTTP surface; .3 event contracts |
| E19-T15 | N/N+1 upgrade test in CI — previous minor's tests against current schema, automated per Architecture §36 (M5 exit criterion)                                   | INF | P0  | —       | M/2d   | Lane green; failure blocks release                                                                              |
| E19-T16 | Migration-path rehearsal — 0.x→1.0 upgrade executed on a seeded production-shaped dataset; guide written from the rehearsal                                    | REL | P0  | T14     | M/2d   | Timed, documented; rollback path tested                                                                         |
| E19-T17 | 1.0 release train — kernel, tenancy, auth, rbac, audit to 1.0.0; compat table; LTS support-line statement                                                      | REL | P0  | T14–T16 | M/2d   | Published with provenance; support policy live                                                                  |
| E19-T18 | Deprecation policy activation — post-1.0 semver promise doc + `Deprecation` header tooling live (API §18)                                                      | REL | P1  | T17     | S/1d   | Policy page linked from every package README                                                                    |

### F19.5 Operational Readiness

| ID      | Task — Description                                                                                                                                                           | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------ | -------------------------------------------------------- |
| E19-T19 | Security-response fire drill — simulated critical vuln: report→advisory→patch→backport→disclosure inside the < 7-day median target                                           | SEC | P0  | E01-T13 | M/2d   | Drill retro; gaps fixed; timing published internally     |
| E19-T20 | Backport automation — patch-release tooling for the supported line                                                                                                           | INF | P1  | T17     | M/2d   | One-command backport PR for a sample fix                 |
| E19-T21 | Telemetry decision finalization — opt-in deployment telemetry design (vision metric: production deployments) with explicit-consent flow, or explicit decision not to ship it | DOC | P1  | —       | S/1d   | ADR either way (vision §18: no telemetry without opt-in) |
| E19-T22 | Runbook validation pass — every E18-T16 runbook re-executed against 1.0                                                                                                      | DOC | P1  | T17     | S/1d   | Each runbook has a last-verified stamp                   |

---

## E20 — Community & Launch (M5, 14 tasks, ~18d)

**Goal:** the two funnels (first hour, first PR) instrumented and optimized;
launch executed as an engineering deliverable, not an afterthought.

### F20.1 Contribution Funnel

| ID      | Task — Description                                                                                                                 | Cat | Pri | Deps    | Cx/Est  | Acceptance criteria & subtasks                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------- | ----------------------------------------------------------- |
| E20-T01 | Good-first-issue program — 20 curated, scoped, mentored issues across modules with reproduction + pointers                         | DOC | P0  | M4 exit | M/2d    | Each issue solvable < 1 day by an outsider; labels + board  |
| E20-T02 | First-PR experience audit — outsider clone→test→PR walkthrough timed; friction fixes (CONTRIBUTING, dev-container option)          | INF | P0  | T01     | M/2d    | < 30 min to first green local test run; friction log closed |
| E20-T03 | Contribution ladder doc — user→reporter→adapter author→module contributor→maintainer with explicit criteria (vision §17)           | DOC | P1  | —       | S/1d    | Published; criteria objective                               |
| E20-T04 | Community adapter registry — listing process + certification tiers (contract-suite proof) in docs (Architecture §24)               | DOC | P1  | E18-T15 | S/1d    | Submission template live                                    |
| E20-T05 | Review SLA + triage rotation — public SLAs (first response 3 days), rotation among maintainers, stale-bot policy (humane settings) | INF | P1  | —       | S/1d    | SLA published; dashboard tracks                             |
| E20-T06 | GitHub Discussions structure — support/design/RFC/show-and-tell categories, seeded content                                         | INF | P1  | —       | XS/0.5d | Categories live with 5 seed threads                         |

### F20.2 Launch

| ID      | Task — Description                                                                                                                            | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| E20-T07 | Launch narrative & materials — positioning ("the third path"), 1.0 announcement post, demo video script, comparison page (honest, per vision) | DOC | P0  | E19-T17 | L/3d   | Founder-approved; comparison page fact-checked against competitors' current docs. Sub: .1 post; .2 video; .3 comparison |
| E20-T08 | Launch-day readiness — docs-site load headroom, reference-app rate limits, triage staffing plan for launch week                               | INF | P0  | T07     | S/1d   | Load test on docs site; on-call calendar for the week                                                                   |
| E20-T09 | Launch execution — coordinated: HN/Reddit/newsletters, 1.0 tags, announcement publish                                                         | INF | P0  | T08     | S/1d   | Checklist executed; metrics capture from hour zero                                                                      |
| E20-T10 | Post-launch triage sprint — dedicated week: issue triage, hot-fix lane, FAQ harvesting into docs                                              | INF | P0  | T09     | L/5d   | All launch-week issues triaged in SLA; top 10 confusions → docs PRs                                                     |

### F20.3 Measurement & Cadence

| ID      | Task — Description                                                                                                                             | Cat | Pri | Deps | Cx/Est | Acceptance criteria & subtasks                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ---- | ------ | ------------------------------------------------------------ |
| E20-T11 | Success-metrics dashboard — vision §12 metrics tracked (downloads, stars, contributors, time-to-first-app funnel)                              | INF | P1  | T09  | M/2d   | Dashboard reviewed monthly; metric owners named              |
| E20-T12 | Monthly devlog cadence — written changelog/devlog #1 published, template + calendar (vision §17)                                               | DOC | P1  | T09  | S/1d   | First issue out; cadence committed                           |
| E20-T13 | Community adapter kickstart — partner with 2 early adopters/authors on first community adapters (mail or queue targets)                        | DOC | P2  | T04  | M/2d   | ≥ 1 community adapter certified in first quarter post-launch |
| E20-T14 | Post-launch retrospective + roadmap v2 — M0–M5 retro; next-cycle blueprint seeded (webhooks-for-inbound? feature-flags module? AI module ADR?) | DOC | P0  | T10  | S/1d   | Retro doc; roadmap v2 draft for founder review               |

---

## Blueprint Tally

| Milestone | Epics                 | Tasks (rows) |          + Inline subtasks | Est. days |
| --------- | --------------------- | -----------: | -------------------------: | --------: |
| M0        | E01–E04               |           76 |                        ~34 |       118 |
| M1        | E05–E06 (+E14 F1–F3)  |           90 |                        ~40 |       150 |
| M2        | E07–E08               |           42 |                        ~12 |        62 |
| M3        | E09–E13               |          110 |                        ~40 |       164 |
| M4        | E14 F4–F5, E15–E18    |           86 |                        ~26 |       128 |
| M5        | E19–E20               |           36 |                        ~12 |        54 |
| **Total** | 20 epics, 96 features |     **~440** | **~164 → ~604 work items** |  **~610** |

**Stopping here, per instruction.** Upon approval this blueprint becomes the
backlog of record: tasks migrate to the tracker with these IDs, M0 (E01–E04) is
scheduled first, and implementation begins at E01-T01 — the first code-adjacent
work since the kernel, now fully covered by design.
