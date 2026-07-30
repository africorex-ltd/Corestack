# E05 Readiness Gate — Report

- **Date:** 2026-07-30
- **Scope:** Sections 8–11 of the founder's E05 Readiness Gate directive
  (ergonomics score, GO/NO-GO verdict, permanent policy adoption, expected
  outcome). Sections 2–3 (friction log), 4–5 (export snapshots, mutation
  proof), 6 (alpha release prep), and 7 (tenancy contract) are covered in
  their own documents, cross-referenced below.

## Section 8 — Platform ergonomics score

Each score is evidence-grounded against this gate's own findings, not a
subjective impression.

| Dimension | Score | Evidence |
| --- | --- | --- |
| Module creation | **3/10** | No scaffold generator exists anywhere in the repo (`tooling/scripts/` has 2 unrelated scripts). A contributor's only path is hand-copying `examples/acme-crm-module`'s package layout, including discovering by its absence that it has no `vitest.config.ts`. See [e05-readiness-friction-log.md](e05-readiness-friction-log.md), step 1 — the single lowest-scoring finding in this whole gate. |
| Repository ergonomics | **8/10** | `OrgScopedContext`'s type-level narrowing (a bare `Context` is a *compile error* against org-scoped helpers, proven by a real `ts-expect-error` test) is a genuinely strong safety property. The two-transactional-shapes split (`ctx.sql` inside a `UnitOfWork`, `runOrgScopedQuery` standalone) is well-documented and demonstrated correctly in the golden path. Docked 2 points only because getting this split backwards is a real, if well-guarded, mistake class (the golden path's own README calls it out as "exactly the mistake step 2 warns about"). |
| RLS ergonomics | **6/10** | *Applying* RLS at runtime is excellent — fail-closed by design (no `missing_ok`), empirically verified GUC-scoping behavior documented, `withOrgContext`/`runOrgScopedQuery` make the safe path the easy path. *Authoring* RLS for a new table is where this drops: `buildTenantIsolationDdl()` exists to generate the exact DDL and nothing bridges it to an actual migration file — every module's RLS policy is hand-transcribed SQL, verified against the generator by eyeball, not by tooling. See friction log step 6. |
| Testing ergonomics | **9/10** | The strongest asset in the platform. 8 kernel ports each have an executable, cross-adapter contract suite; the framework itself adds zero runtime dependency; `contract-governance.md` and `how-to-add-a-new-adapter.md` make the pattern genuinely reusable, not just internally consistent. This session's own mutation-proof review (3 of 4 previously-unproven suites closed, 1 honestly deferred) is itself evidence the discipline holds up under scrutiny. |
| Contract ergonomics | **7/10** | Kernel-port contract governance (the matrix, the suite-by-suite log, the certification vocabulary — certified/pending/blocked/not-applicable) is precise and well-understood. What's genuinely unclear: whether a **module's own** repository ports (like `ContactRepository`, or Tenancy's future `OrganizationRepository`) need anything analogous — the golden path's README answers this correctly ("nothing new needed") but none of the five docs Section 3 restricted this review to says so explicitly. A contributor following only those five documents would hit real ambiguity here. |
| Documentation | **7/10** | Deep and cross-referenced for everything that exists — the golden path's own README is exemplary, `contract-governance.md`'s suite-by-suite log is a genuinely useful institutional memory. The gap is precisely located, not diffuse: nothing walks package-creation through first-booting-module (friction log steps 1–3, 10, 14), and no doc showed a module's config schema actually wired end-to-end until this gate found the gap. |
| Discoverability | **5/10** | Until this gate's fix, `CONTRIBUTING.md` — the project's front door — never linked the *mandatory* tenant-safety guide or the golden-path example, and stated `test:integration` needs Docker when a local-Postgres path has existed since the dual-mode bootstrap. Both fixed in this pass (see below), but their prior absence is the finding: a first-time contributor reading only the front-door doc would have missed the single most important guide in the repository and hit a false Docker requirement. Beyond that specific fix, there is still no single "start here" map across the now-substantial `docs/{testing,security,contributing,releases,modules,engineering,quality,adr}/` tree. |
| Contributor experience (overall) | **6/10** | A composite, not an average: once past the two 🔴 friction items and the discoverability gap, the experience is genuinely strong (rich guides, a real worked example, an unusually rigorous empirical-verification culture actively modeled in every doc). But those are exactly the things a *new* contributor hits first, before ever reaching the strong parts — which is why this score sits below the average of the rows above it rather than at their midpoint. |

**Two concrete fixes landed as part of writing this score, not left as
findings-only** (both small, low-risk, factual corrections, not scope
changes): `CONTRIBUTING.md` now links the tenant-safety guide, the golden
path, and the new onboarding checklist, and corrects the stale
Docker-only integration-test claim.

## Section 9 — GO / NO-GO verdict

**GO.**

Reasoning, following the same discipline
[e04-completion-report.md](e04-completion-report.md) established for its
own verdict — state the plain reading, don't manufacture a more dramatic
one:

- **Sections 4 and 5's findings were fixes, and the fixes are already
  applied and verified**, not just recommended: all 5 export conditions
  across kernel/platform are now snapshotted; 3 of 4 previously-unproven
  contract suites gained real mutation proof, with the 4th's deferral
  reasoned and documented rather than silently left open. Re-running the
  gate after these lands with nothing outstanding from those two
  sections.
- **Sections 2–3's two 🔴 findings (no module scaffold, no RLS-DDL
  codegen bridge) are not blockers to *starting* E05 — they are
  precisely what E05-T01 exists to resolve.** The blueprint's own framing
  of E05-T01 ("this scaffold becomes the documented module template")
  means the scaffold-gap finding is not a prerequisite for E05, it is
  E05's first deliverable. Treating it as a NO-GO condition would be
  asking E05 to solve its own first task before being allowed to start.
  The RLS-DDL bridge is a real decision Tenancy's own migration (E05-T21)
  should make deliberately when it's written — flagged with enough detail
  in the friction log that it can't be silently skipped, not something
  this readiness gate should build speculatively (which the gate's own
  Section 1 explicitly rules out: "a readiness and ergonomics review, not
  a feature phase").
- **The discoverability fix (Section 8) was small and applied inline**,
  not deferred.
- **No open P0/P1 finding exists anywhere in this codebase** (per the
  quality dashboard's standing gate) that E05 would inherit.

This is **GO**, not **GO WITH FIXES**, because "GO WITH FIXES" implies
outstanding fixes still need to be applied before starting — and the only
fixes this gate identified as genuinely gating (the export-snapshot gap,
the mutation-proof gap, the discoverability front-door gap) are already
applied and re-verified above, not deferred to a future pass.

## Section 10 — Recommendations adopted as permanent policy

Per the founder directive's explicit instruction, adopted permanently
starting with E05:

1. Every new module begins with a contract document (this gate's own
   [tenancy-contract.md](../modules/tenancy-contract.md) is the first
   instance and the template for the next).
2. Every module must have a golden-path example — `acme-crm-module`
   already sets this bar; Tenancy inherits the obligation to meet it, not
   merely reference it.
3. Every module must register purge semantics — Tenancy's contract
   document already specifies this reuses E03-T33's protocol directly.
4. Every module must declare health signals — flagged in the tenancy
   contract as a genuinely open design question for E05-T01 to resolve,
   not pre-decided here.
5. Every module must document RLS expectations — Tenancy's contract
   document does this already, including naming the one open question
   (`organizations`' own RLS shape) rather than assuming an answer.
6. Every module must pass architecture fitness tests before
   implementation is considered complete — already mechanically true
   today (`packages/architecture-tests` scans `examples/*` and will scan
   `packages/tenancy` identically once it exists).

## Section 11 — Expected outcome (summary)

- **Is the platform truly ready for product code?** Yes, with two named,
  non-blocking gaps that E05's own first task and first migration
  naturally resolve — not silent readiness, evidenced readiness.
- **What friction would external contributors hit?** Documented precisely
  in [e05-readiness-friction-log.md](e05-readiness-friction-log.md): 2
  blocking-grade items (both addressed above), 4 real-but-survivable
  items, 8 steps with no friction found.
- **Which governance gaps remain?** `UnitOfWork`'s mutation-proof
  deferral (deliberate, documented), the RLS-DDL codegen bridge decision
  (deferred to E05-T21 by design), and the changeset backlog identified in
  [maintainer-release-checklist.md](../releases/maintainer-release-checklist.md)
  (not an E05 blocker — a release-process gap, orthogonal to module
  readiness).
- **Should E05 start immediately?** Per the verdict above: yes.
