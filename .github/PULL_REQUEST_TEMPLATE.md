<!-- Title format: conventional commit, e.g. `feat(tenancy): invite member use case` -->

## What & why

<!-- What this changes and why. Link the driving artifact: -->

- **Task / Issue:** <!-- [E05-T17] / #123 / N/A for drive-by fixes -->
- **ADR / RFC (if architectural):** <!-- docs/adr/00xx or N/A -->

## Type of change

<!-- Check all that apply -->

- [ ] Feature (blueprint task or accepted feature request)
- [ ] Bug fix
- [ ] Documentation
- [ ] Refactor / internal (no public-surface change)
- [ ] **Breaking change** — changeset says `major` (or `minor` pre-1.0) and migration notes are included

## Checklist

- [ ] Acceptance criteria of the linked task are demonstrably met
- [ ] Tests per the task's **category standard** (docs/engineering/00-OVERVIEW.md §4) are included
- [ ] Docs updated (use-case reference / config reference / guide) — or genuinely N/A
- [ ] Changeset added for every published package whose behavior changes
- [ ] **New runtime dependency?** Justification below (required — no exceptions)
- [ ] Touches auth, tenancy isolation, secrets, or crypto? → `security-review` label applied
- [ ] DB migration included? Lock-impact note in the migration header; expand-and-contract respected

## Dependency justification

<!-- Only if a new runtime dependency was added: what, why, alternatives rejected, maintenance posture. Delete section otherwise. -->

## How I verified this

<!-- Commands run, test output summary, manual verification steps. "CI is green" alone is not verification of behavior. -->
