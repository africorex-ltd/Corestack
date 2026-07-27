# Engineering Blueprint — M2: Control Plane

Epics E07 (RBAC), E08 (Audit). Standards: [00-OVERVIEW.md](00-OVERVIEW.md).
Design sources: Architecture §17–18, §6; DB §6, §8; API §7, §13–14.

---

## E07 — RBAC Module `@corestack/rbac` (M2, 24 tasks, ~36d)

**Goal:** deny-by-default org-scoped RBAC with decision rationale, layering on
tenancy's baseline roles, cache-invalidated by version bump.

### F7.1 Domain

| ID      | Task — Description                                                                                                               | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| E07-T01 | Module scaffold from template                                                                                                    | INF | P0  | E05-T29 | S/1d   | Boots; lint green                                                                                           |
| E07-T02 | Permission model — `resource:action` key VO, registry semantics (code-is-truth), retired-permission behavior                     | DOM | P0  | T01     | S/1d   | Key format property-tested; retired → deny                                                                  |
| E07-T03 | `Role` aggregate — system vs custom, org scoping, grant set; system-immutability rule                                            | DOM | P0  | T02     | M/2d   | Invariants: custom grants ⊆ catalog; system role mutation → ForbiddenError; events                          |
| E07-T04 | Decision model — `Decision` VO with allow/deny + rationale (matched role/rule, evaluated subject state)                          | DOM | P0  | T02     | S/1d   | Rationale serializable, PII-free (snapshot)                                                                 |
| E07-T05 | Baseline-role bridge — tenancy baseline (owner/admin/member) as implicit system-role floor (Architecture §8 degradation inverse) | DOM | P0  | T03     | M/2d   | With rbac installed, baseline maps to system roles; without custom roles behavior identical to tenancy-only |

### F7.2 Application — Evaluation

| ID      | Task — Description                                                                                                  | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E07-T06 | Ports — RoleRepo, AssignmentRepo, PermissionCatalogSync, AuthzVersionRepo                                           | APP | P0  | T03          | S/1d   | Contract suites declared                                                                                                                               |
| E07-T07 | `EvaluatePermission` (the PolicyDecisionPort impl) — membership check + role union + deny-default; **the hot path** | APP | P0  | T05, T06     | L/3d   | Benchmark ≤ 5 ms p95 (cached) registered; inactive membership → deny; rationale complete. Sub: .1 evaluator; .2 subject snapshot loading; .3 benchmark |
| E07-T08 | Decision cache — (org, subject, authz-version) keyed snapshots (Architecture §12/§18)                               | APP | P0  | T07, E02-T07 | M/2d   | Version bump invalidates (tested cross-node semantics with fake); forbidden-cache rules honored                                                        |
| E07-T09 | Use-case guard integration — declarative `requires(permission)` consumed by all modules' protected use cases        | APP | P0  | T07          | M/2d   | Guard produces ForbiddenError with decision attached; adopted retroactively by E05/E06 protected cases (tracked checklist)                             |
| E07-T10 | Permission registration API — module + adopter registration at composition (Architecture §18), catalog sync to DB   | APP | P0  | T02, T06     | M/2d   | Duplicate key collision fails boot; catalog table mirrors code post-boot                                                                               |
| E07-T11 | `CheckPermission` use case — self + others variant with rationale (API §7 support endpoint)                         | APP | P1  | T07          | S/1d   | Others requires `rbac:assignment.read`                                                                                                                 |
| E07-T12 | `GetMyPermissions` — effective set + version for UI gating (ETag source)                                            | APP | P0  | T07          | S/1d   | Matches evaluator exactly (shared code path, tested equivalence)                                                                                       |

### F7.3 Application — Role & Assignment Management

| ID      | Task — Description                                                                                                  | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | -------------------------------------------------------------------------------- |
| E07-T13 | Role CRUD use cases — create (entitlement-gated `custom_roles`, grants⊆creator), update, delete (in-use → conflict) | APP | P0  | T03, T06     | M/2d   | Escalation guard tested (grant-what-you-lack fails); RESTRICT semantics surfaced |
| E07-T14 | Assignment use cases — assign/unassign/list with version bump in-tx                                                 | APP | P0  | T13          | M/2d   | Bump atomic with change (crash test via E03-T13 pattern)                         |
| E07-T15 | Member-removed cleanup consumer — assignment removal on `member.removed` (belt-and-braces per DB §6)                | APP | P1  | T14, E03-T14 | S/1d   | Idempotent; orphaned assignment grants nothing (evaluator test)                  |

### F7.4 Adapter & Interface

| ID      | Task — Description                                                                         | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                        |
| ------- | ------------------------------------------------------------------------------------------ | --- | --- | ------------ | ------ | ----------------------------------------------------------------------------------------------------- |
| E07-T16 | RBAC schema migrations — DB §6 tables, catalog FK, PUX system-role pattern, RLS            | ADP | P0  | T06          | M/2d   | RESTRICT on assignments→roles verified                                                                |
| E07-T17 | Repositories — role/assignment/catalog/version repos                                       | ADP | P0  | T16          | M/2d   | Contract suites green; evaluator lookup uses the exact (org,user) index (explain-plan check)          |
| E07-T18 | RBAC endpoints — API §7 set (roles, assignments, catalog, check, my-permissions with ETag) | API | P0  | T11–T14, E14 | L/3d   | 304 flow on my-permissions tested; error codes registered. Sub: .1 roles; .2 assignments; .3 check+me |
| E07-T19 | Isolation + authz matrix wiring                                                            | SEC | P0  | T17          | M/2d   | Gating; matrix includes rbac's own endpoints (meta-authz)                                             |

### F7.5 Completion

| ID      | Task — Description                                                                                                   | Cat | Pri | Deps     | Cx/Est  | Acceptance criteria & subtasks                         |
| ------- | -------------------------------------------------------------------------------------------------------------------- | --- | --- | -------- | ------- | ------------------------------------------------------ |
| E07-T20 | Privilege-escalation adversarial pass — self-grant, role-edit-to-escalate, key-scope laundering, race-window tests   | SEC | P0  | T18      | M/2d    | All scenarios fail closed                              |
| E07-T21 | RBAC threat model                                                                                                    | SEC | P0  | T20      | S/1d    | Per module gate                                        |
| E07-T22 | Adopter guide — registering permissions, guarding adopter use cases, decision-port extension seam (OPA/SpiceDB note) | DOC | P0  | T09, T10 | M/2d    | Worked example: adopter resource + role editor UI flow |
| E07-T23 | RBAC `/testing` subpath — permission/role fixtures, matrix helpers                                                   | TST | P1  | T17      | S/1d    | Consumed by E05/E06 retrofit                           |
| E07-T24 | RBAC 0.1 release                                                                                                     | REL | P0  | all      | XS/0.5d | Published; M2 criteria partial check                   |

---

## E08 — Audit Module `@corestack/audit` (M2, 18 tasks, ~26d)

**Goal:** the append-only compliance trail, fed exclusively by the outbox —
complete-by-construction (DB §8).

### F8.1 Domain & Ingestion

| ID      | Task — Description                                                                                                        | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | ------------------------------------------------------------------------------------------------------------- |
| E08-T01 | Module scaffold from template                                                                                             | INF | P0  | E05-T29      | S/1d   | Boots; lint green                                                                                             |
| E08-T02 | Audit event model — action taxonomy, actor denormalization rules, redaction-map contract per source module                | DOM | P0  | T01          | M/2d   | Redaction map type: modules declare sensitive paths; unmapped module events → safe-default (metadata dropped) |
| E08-T03 | Outbox consumer — subscribe-all, transform envelope→audit record, idempotent insert (event_id UK)                         | APP | P0  | T02, E03-T12 | M/2d   | Replay-safe (crash suite); consumer lag metric wired                                                          |
| E08-T04 | Actor-label denormalization — resolve display labels at ingest via contracts subpaths (types-only rule, Architecture §47) | APP | P0  | T03          | M/2d   | Labels survive user purge (tested post-purge readability)                                                     |
| E08-T05 | Redaction enforcement — apply maps before insert; property test: declared-sensitive paths never persisted                 | SEC | P0  | T02, T03     | M/2d   | Fuzz metadata payloads against maps (E04-T15 rig)                                                             |

### F8.2 Query Surface

| ID      | Task — Description                                                                                                      | Cat | Pri | Deps               | Cx/Est  | Acceptance criteria & subtasks                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------------ | ------- | --------------------------------------------------------------------------------- |
| E08-T06 | `QueryAuditEvents` — org timeline with filters (actor, action, resource, time range) + FTS `q` param, cursor pagination | APP | P0  | T03                | M/2d    | Every filter maps to a DB §8 index (explain-plan check); FTS on search column     |
| E08-T07 | `GetAuditEvent` — single record with full metadata                                                                      | APP | P1  | T06                | XS/0.5d | Cross-org → NotFound                                                              |
| E08-T08 | Audit export — async job producing org-scoped export (CSV/JSON) delivered via notification + signed URL                 | APP | P1  | T06, E11/E13 ports | M/2d    | Export respects redaction; job pattern documented (reused by GDPR export E06-T39) |
| E08-T09 | Retention manager — partition-drop scheduling per policy, org-notification before drop (DB §8)                          | APP | P1  | E03-T03            | M/2d    | Drop blocked while checkpoint behind; notice event emitted                        |

### F8.3 Adapter & Interface

| ID      | Task — Description                                                                                  | Cat | Pri | Deps     | Cx/Est | Acceptance criteria & subtasks                                                     |
| ------- | --------------------------------------------------------------------------------------------------- | --- | --- | -------- | ------ | ---------------------------------------------------------------------------------- |
| E08-T10 | Audit schema migration — partitioned events table, INSERT/SELECT-only grants, indexes + GIN (DB §8) | ADP | P0  | T02      | M/2d   | Immutability verified by test (UPDATE as app role fails); partitions auto-created  |
| E08-T11 | Audit repository — insert path + query path honoring partitions                                     | ADP | P0  | T10      | M/2d   | Contract suite; partition-pruning verified in explain plan for time-ranged queries |
| E08-T12 | Org audit endpoints — API §13/§5 org-scoped listing + FTS                                           | API | P0  | T06, E14 | M/2d   | Permission `audit:event.read`; pagination snapshot                                 |
| E08-T13 | Platform admin audit endpoints — cross-org query under `admin:audit.read` (API §14)                 | API | P1  | T12      | S/1d   | Operator actions themselves audited (meta-audit test)                              |
| E08-T14 | Isolation wiring — org scoping + the admin-unscoped exception explicitly modeled                    | SEC | P0  | T11      | S/1d   | Suites gating                                                                      |

### F8.4 Completion

| ID      | Task — Description                                                                                                                  | Cat | Pri | Deps        | Cx/Est | Acceptance criteria & subtasks                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ----------- | ------ | ----------------------------------------------------------------------------------------------- |
| E08-T15 | Completeness verification suite — every module's published events land as audit records (matrix auto-derived from event registries) | TST | P0  | T03         | M/2d   | New module events without audit mapping fail the suite — completeness by construction, enforced |
| E08-T16 | Audit threat model — tamper resistance, log-injection via metadata, retention/compliance edge cases                                 | SEC | P0  | T15         | S/1d   | Module gate                                                                                     |
| E08-T17 | Compliance guide — mapping audit trail to SOC 2 CC-series evidence requests (vision §15 dividend)                                   | DOC | P1  | T12         | M/2d   | Worked evidence-pull example                                                                    |
| E08-T18 | Audit 0.1 release + M2 exit review                                                                                                  | REL | P0  | all E07/E08 | S/1d   | M2 exit criteria all check (incl. authz-version invalidation demonstrated end-to-end)           |
