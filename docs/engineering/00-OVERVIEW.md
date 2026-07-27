# CoreStack — Engineering Blueprint: Overview & Standards

- **Status:** Draft, awaiting founder approval
- **Version:** 0.1
- **Date:** 2026-07-28
- **Depends on:** [Vision](../product/VISION.md), [Architecture](../architecture/ARCHITECTURE.md), [Database](../architecture/DATABASE.md), [API](../architecture/API.md)

This directory is the complete decomposition of CoreStack into engineering work:
**6 milestones → 20 epics → 96 features → ~440 tasks (with inline subtasks,
~600 work items total)**.

| File                                             | Epics                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [01-foundation.md](01-foundation.md)             | E01 Foundation & Governance, E02 Kernel, E03 Platform Infrastructure, E04 Testing Infrastructure |
| [02-identity.md](02-identity.md)                 | E05 Tenancy, E06 Auth                                                                            |
| [03-control-plane.md](03-control-plane.md)       | E07 RBAC, E08 Audit                                                                              |
| [04-revenue-delivery.md](04-revenue-delivery.md) | E09 Billing, E10 Notifications, E11 Jobs, E12 Webhooks, E13 Storage                              |
| [05-interface.md](05-interface.md)               | E14 HTTP Interface & API Standards, E15 CLI, E16 Client SDK                                      |
| [06-apps-docs.md](06-apps-docs.md)               | E17 Reference Application, E18 Documentation                                                     |
| [07-hardening-launch.md](07-hardening-launch.md) | E19 Security & Performance Hardening, E20 Community & Launch                                     |

## 1. Task Record Format

Every task is one table row carrying: **Task ID · Title — Description · Category
· Priority · Dependencies · Complexity/Estimate · Acceptance Criteria (+ inline
subtasks)**. The remaining three required fields — **Testing Requirements,
Documentation Requirements, Definition of Done** — are _normative per category_
(§4) and apply to every task of that category; a task's AC cell adds
task-specific requirements on top. This is deliberate: repeating identical
boilerplate 440 times would hide the signal; a category standard is enforceable
in review, a copy-paste block is not.

- **Task ID:** `E<epic>-T<nn>`; subtasks `E<epic>-T<nn>.<n>`. IDs are permanent;
  cancelled tasks are struck through, never renumbered.
- **Dependencies:** listed by ID; `—` = none beyond its feature's predecessor
  ordering. Cross-epic deps always explicit.

## 2. Priority Scale

| Pri    | Meaning                                                       |
| ------ | ------------------------------------------------------------- |
| **P0** | Blocks its milestone's exit criteria. Scheduled first.        |
| **P1** | Required for the milestone; some sequencing freedom.          |
| **P2** | Should ship in the milestone; first candidate to defer.       |
| **P3** | Valuable, unscheduled; needs a milestone owner to pull it in. |

## 3. Complexity & Time Scale

Estimates are for one engineer who has read the design docs. **XL tasks may not
enter a sprint — they must be split first** (their listed subtasks are the split).

| Code | Complexity                           | Estimate  |
| ---- | ------------------------------------ | --------- |
| XS   | Trivial, mechanical                  | ≤ 0.5 day |
| S    | Small, one concern                   | 1 day     |
| M    | Moderate, several concerns           | 2 days    |
| L    | Large, cross-cutting within a module | 3–5 days  |
| XL   | Must be split                        | 5–8 days  |

Blueprint totals: ~610 engineer-days of estimated work. With 2 engineers at
~70% focus factor this is ~20 months to M5 — consistent with the vision's
15–18-month 1.0 target only if M3/M4 run partially parallel with 3 contributors;
the milestone plan (§6) assumes exactly that.

## 4. Category Standards (Testing · Documentation · Definition of Done)

Every task carries one category. The category defines its three standard fields.

### Global Definition of Done (all categories)

1. Code-reviewed and merged to `main` via PR referencing the Task ID.
2. Full CI green — including lint/boundary rules, typecheck, and (where touched)
   the unskippable cross-tenant isolation suite.
3. No new runtime dependency without written justification in the PR.
4. Changeset added when a published package's behavior changes.
5. Task's AC demonstrably met — reviewer checks AC against the diff, not intent.

### Per-category standards (additive to global)

| Cat     | Applies to                                       | Testing Requirements                                                                                                    | Documentation Requirements                                                             | DoD addition                                                                          |
| ------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **DOM** | domain layer (entities, VOs, events, invariants) | Unit tests, no I/O; every invariant has a violating test; ≥ 90% branch coverage                                         | Glossary entry for each new term; invariants listed in module docs                     | Zero imports from outside domain+kernel (lint-proven)                                 |
| **APP** | use cases, ports, DTOs                           | Application tests with fakes: happy path, every declared error, authz denial (where protected), event emission asserted | Use-case entry in module reference (inputs, outputs, errors, permission, events)       | Returns `Result`; one transaction; port additions justified against Architecture §3   |
| **ADP** | adapters (Postgres, providers)                   | Passes the port's full contract suite against real infrastructure (Testcontainers) + adapter-specific integration tests | Adapter config reference; any deviation from port semantics is a doc'd bug, not a note | Migration files included when schema changes; RLS policies included for tenant tables |
| **API** | HTTP bindings, schemas, endpoints                | Binding tests through real HTTP: authn/authz, validation (422 shape), error-code mapping, OpenAPI snapshot updated      | Endpoint reference auto-generated + example added; error codes registered              | Zod boundary schema is the OpenAPI source; permission tag (`x-permission`) present    |
| **SEC** | adversarial/hardening work                       | Attack-scenario tests (the listed scenarios must exist and fail-closed); isolation suite extended where relevant        | Threat-model section updated                                                           | Reviewed by a second reviewer with security focus                                     |
| **INF** | CI/CD, repo tooling, environments                | Pipeline run demonstrating the behavior (link in PR)                                                                    | `tooling/` or workflow README updated                                                  | Rollback path stated in PR                                                            |
| **TST** | test infrastructure, fakes, contract kits        | The kit's own self-tests; consumed by ≥ 1 real usage in the same or next task                                           | Kit usage guide                                                                        | Published via `/testing` subpath where adopter-facing                                 |
| **DOC** | guides, references, runbooks                     | Docs build + link check green; code samples type-checked in CI                                                          | — (it _is_ documentation)                                                              | Technical review by the owning module's engineer                                      |
| **REL** | releases, packaging                              | Dry-run publish + install-from-tarball smoke test                                                                       | Changelog + migration notes                                                            | Provenance attestation verified                                                       |

## 5. Sequencing Rules (cross-epic invariants)

1. **E01–E04 (M0) gate everything:** no module work starts before the contract
   kit (E04) exists, because adapters without contract suites create untested
   port drift from day one.
2. **Tenancy before auth completes:** auth's org-scoped API keys and invitation
   acceptance depend on tenancy contracts (E05 → E06 ordering within M1).
3. **Outbox before any event consumer:** E03-T10..T14 precede audit (E08),
   webhooks (E12), notifications (E10).
4. **HTTP standards early, OpenAPI late:** E14's standards features (problem
   details, pagination, CSRF) land inside M1; spec generation and SDK (E14-F4,
   E16) land in M4.
5. **Nothing ships to npm before REL tasks of E01 are done** (provenance,
   2FA, dry-run pipeline) — supply-chain posture precedes the first artifact.

## 6. Milestones

| ID     | Name               | Exit criteria (all must hold)                                                                                                                                                 | Epics                  |
| ------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **M0** | Foundation         | CI green incl. security lane; kernel 0.1 publishable (dry-run); outbox + migration runner + composition root working in a sample harness; contract kit consumed by ≥ 1 suite  | E01–E04                |
| **M1** | Identity preview   | `@corestack/tenancy` + `@corestack/auth` 0.x published; quickstart doc proves register→org→invite in < 1 h; isolation suite gating CI; internal security self-review complete | E05, E06, parts of E14 |
| **M2** | Control plane      | rbac + audit published; permission check endpoint with rationale; audit trail fed exclusively by outbox; authz-version cache invalidation proven                              | E07, E08               |
| **M3** | Revenue & delivery | billing (Stripe reference) + webhooks + notifications + jobs + storage published; crash-consistency suite green; webhook delivery contract documented                         | E09–E13                |
| **M4** | Surface complete   | Full REST surface bound; OpenAPI artifact per release; `@corestack/client` + CLI shipped; reference app deployed publicly; docs site live                                     | E14–E18                |
| **M5** | 1.0 hardened       | External security audit passed + findings closed; load-test numbers published; N/N+1 upgrade test in CI; 1.0 for kernel+tenancy+auth+rbac+audit; launch executed              | E19, E20               |

## 7. Epic Index & Tally

| Epic | Title                            | Milestone | Features |    Tasks | Est. days |
| ---- | -------------------------------- | --------- | -------- | -------: | --------: |
| E01  | Foundation & Governance          | M0        | 5        |       22 |        30 |
| E02  | Kernel                           | M0        | 3        |       14 |        20 |
| E03  | Platform Infrastructure          | M0        | 5        |       24 |        42 |
| E04  | Testing Infrastructure           | M0        | 4        |       16 |        26 |
| E05  | Tenancy Module                   | M1        | 6        |       30 |        44 |
| E06  | Auth Module                      | M1        | 8        |       44 |        68 |
| E07  | RBAC Module                      | M2        | 5        |       24 |        36 |
| E08  | Audit Module                     | M2        | 4        |       18 |        26 |
| E09  | Billing Module                   | M3        | 6        |       34 |        52 |
| E10  | Notifications Module             | M3        | 4        |       20 |        28 |
| E11  | Jobs Module                      | M3        | 4        |       22 |        34 |
| E12  | Webhooks Module                  | M3        | 4        |       20 |        30 |
| E13  | Storage                          | M3        | 3        |       14 |        20 |
| E14  | HTTP Interface & API Standards   | M1/M4     | 5        |       26 |        38 |
| E15  | CLI                              | M4        | 4        |       16 |        22 |
| E16  | Client SDK                       | M4        | 4        |       18 |        26 |
| E17  | Reference Application            | M4        | 4        |       20 |        30 |
| E18  | Documentation                    | M4        | 5        |       22 |        32 |
| E19  | Security & Performance Hardening | M5        | 5        |       22 |        36 |
| E20  | Community & Launch               | M5        | 4        |       14 |        18 |
|      | **Totals**                       |           | **96**   | **~440** |  **~610** |
