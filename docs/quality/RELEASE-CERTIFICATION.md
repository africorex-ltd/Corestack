# Release Certification Procedure

Every Beta, RC, and Stable release executes this certification and commits
its report to `docs/quality/certifications/` (governance §7.5). A release
without a committed certification report does not ship — the release
conductor is the certifier; security-relevant sections need a second
reviewer post-bus-factor-1.

## Checklist (all items verified, evidence linked)

1. **Functional correctness** — full suite green incl. integration +
   isolation lanes; zero skipped tests without a linked issue.
2. **Performance** — benchmark run vs. budgets (≤5 ms p95 session/policy;
   ≤2 ms use-case overhead); regression vs. last certified run explained or
   fixed. _(Pre-E04: state "harness pending" explicitly.)_
3. **Security** — threat-model review current for changed modules; secret
   flows unchanged or re-audited; no open security advisories on deps
   (or documented acceptance).
4. **API compatibility** — spec diff reviewed; semver class of every change
   verified against the changesets; N/N+1 upgrade lane green (post-M5).
5. **Documentation completeness** — changelog written; migration notes for
   any schema/config change; affected guides updated; docs build green.
6. **Dependency audit** — tree reviewed; new deps justified in the release
   notes; provenance/pins current.
7. **CI integrity** — silent-success guards active; required checks
   unmodified (or changes ratified).
8. **Upgrade path** — from previous release rehearsed (migrate → deploy) on
   a seeded fixture.
9. **Rollback strategy** — documented for this release (revert-release
   procedure; migration contract confirms old code runs on new schema).
10. **Release notes** — human-written train digest in CHANGELOG.md.

## Report format

`certifications/<package-or-train>-<version>.md` containing: scope, evidence
per checklist item (link or inline), deviations with justification, verdict
(**CERTIFIED / BLOCKED**), and the resulting version/tag list.
