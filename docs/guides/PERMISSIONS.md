# Guide: Permissions & Access Control

> **Status: approved structure — content lands with M2** (blueprint E07-T22).
> Audience: adopters. Normative sources: [Architecture §17–18](../architecture/ARCHITECTURE.md),
> [API §7](../architecture/API.md).

## Table of contents & content charter

1. **Mental model** — _What belongs:_ permission strings (`resource:action`),
   roles as named permission sets, assignments scoped to organizations,
   deny-by-default. The two-layer defense (application checks + repository
   tenant scoping) explained in one diagram — why a missed check degrades
   safely.
2. **Baseline roles without RBAC** — _Belongs:_ what owner/admin/member give
   you when only tenancy is installed; the exact capability table; when
   that's genuinely enough (most early products — say so).
3. **Installing RBAC** — _Belongs:_ what changes when the module lands
   (baseline becomes the floor, custom roles layer above), migration
   non-impact, entitlement gating of custom roles.
4. **Registering your own permissions** — _Belongs:_ the composition-time
   registration pattern for adopter resources, naming conventions, how your
   permissions appear in the same catalog/role-editor/audit as platform ones —
   the core DX win, shown end-to-end with the reference app's "projects"
   sample.
5. **Guarding your use cases** — _Belongs:_ the `requires(permission)` guard
   pattern, where checks run (application layer, not middleware — and why),
   combining with entitlement gates.
6. **UI gating** — _Belongs:_ the `my-permissions` + ETag/version pattern for
   frontends, cache-invalidation semantics ("effective within…"), pitfalls
   (UI gating is UX, not security — the server always re-checks).
7. **Custom roles for your customers** — _Belongs:_ exposing role editing to
   org admins safely: grants-⊆-own rule, system-role immutability, seat/tier
   gating.
8. **Debugging access decisions** — _Belongs:_ the check endpoint with
   rationale, reading decision output, the support workflow for "why can't
   X do Y", audit-trail correlation.
9. **Beyond RBAC** — _Belongs:_ honest boundary — resource-instance grants
   are adopter domain or a ReBAC engine behind the decision port; the
   extension seam, with pointers (OPA/SpiceDB adapter pattern). _Never:_
   pretending core RBAC does ReBAC.
10. **Reference** — _Belongs:_ links to the generated permission catalog,
    `rbac/*` error codes, and the authorization-matrix testing helpers for
    adopter test suites.
