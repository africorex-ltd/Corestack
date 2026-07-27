# CoreStack — GitHub Project Plan

- **Status:** Draft, awaiting founder approval
- **Version:** 0.1
- **Date:** 2026-07-28
- **Depends on:** [Engineering Blueprint](00-OVERVIEW.md)
- **Execution note:** the repository has **no GitHub remote yet**. Everything
  here is ready to execute the moment the `africorex-ltd/Corestack` repository is
  created; the commands in §6 are the executable form of this plan. Nothing in
  this document is run until the founder approves repo creation.

---

## 1. Repository Setup

- **Org/repo:** `africorex-ltd/Corestack` (monorepo, per ADR-0002). Additional
  repos later: `corestack/ops` (private, §39 infra-as-code), docs stay in-repo.
- **Settings:** squash-merge only (linear history), merge queue on `main`,
  branch protection (§ see [CONTRIBUTING.md](../../CONTRIBUTING.md) — required
  checks: lint/typecheck/unit/integration/isolation-suite), delete-branch-on-
  merge, Discussions enabled, Projects enabled, wiki disabled (docs live in
  `docs/` — one source of truth).
- **Security:** private vulnerability reporting ON, secret scanning + push
  protection ON, Dependabot alerts ON (Renovate handles updates).

## 2. Milestones

GitHub milestones mirror blueprint milestones 1:1 — the milestone description
carries the exit criteria; a milestone closes only when its exit-criteria
checklist is fully checked.

| Milestone | Title              | Due (target) | Description (exit criteria source)            |
| --------- | ------------------ | ------------ | --------------------------------------------- |
| M0        | Foundation         | +2 months    | Blueprint 00-OVERVIEW §6 M0 row               |
| M1        | Identity preview   | +6 months    | §6 M1 — incl. the timed < 1 h quickstart test |
| M2        | Control plane      | +9 months    | §6 M2                                         |
| M3        | Revenue & delivery | +13 months   | §6 M3                                         |
| M4        | Surface complete   | +16 months   | §6 M4                                         |
| M5        | 1.0 hardened       | +20 months   | §6 M5                                         |

Dates are _targets_ (vision: phases gate on quality, not dates); milestone due
dates get revised openly in the devlog, never silently.

## 3. Label Taxonomy

Prefixed, orthogonal namespaces — one label per namespace per issue, except
`flag:*`. Colors per namespace for scanability.

| Namespace | Labels                                                                                                                                                           | Rule                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `type:`   | `bug` `feature` `task` `docs` `rfc` `question→discussion`                                                                                                        | exactly one; set by template                                 |
| `area:`   | `kernel` `platform` `tenancy` `auth` `rbac` `audit` `billing` `notifications` `jobs` `webhooks` `storage` `http` `cli` `client` `reference-app` `docs-site` `ci` | exactly one primary (add second only for true cross-cutting) |
| `prio:`   | `P0` `P1` `P2` `P3`                                                                                                                                              | blueprint semantics (00-OVERVIEW §2); triage sets it         |
| `size:`   | `XS` `S` `M` `L` `XL`                                                                                                                                            | blueprint scale; `XL` must be split before scheduling        |
| `status:` | `needs-triage` `needs-repro` `blocked` `ready` `in-progress` `needs-review`                                                                                      | workflow state (mirrored in Project board)                   |
| `flag:`   | `good-first-issue` `help-wanted` `breaking-change` `security-review` `regression` `launch-week`                                                                  | zero or more                                                 |

Deliberate absences: no `wontfix` (close with a written reason instead — a
label is not an explanation); no `priority:critical` duplicate of P0; no
per-milestone labels (milestones exist).

## 4. Projects (GitHub Projects v2)

**One project: "CoreStack Roadmap"** — a single source of scheduling truth;
per-epic slicing is done with views, not separate projects (separate projects
drift).

Custom fields:

- `Epic` (single select: E01–E20) — the blueprint mapping
- `Priority` / `Size` (mirrors labels — set by automation, §5)
- `Category` (DOM/APP/ADP/API/SEC/INF/TST/DOC/REL) — drives review standards
- `Target milestone` (iteration-free; milestones own dates)

Views:

1. **Now (board)** — current milestone, grouped by `status:*`; the daily view.
2. **Milestone table** — all issues, grouped by milestone, sorted prio→size;
   the planning view.
3. **Epic drill-down** — filtered per `Epic`; the feature-lead view.
4. **Security** — `flag:security-review` + `type:bug`+`area:auth|platform`;
   reviewed weekly, never allowed to age silently.
5. **Community** — `flag:good-first-issue` + `flag:help-wanted` with staleness
   sort; feeds the contribution funnel (E20).

## 5. Issue Population Strategy

**Decision: issues are created wave-by-wave, not 440 at once.**

- **Now (repo creation):** all **M0 tasks (E01–E04, 76 issues)** created from
  the blueprint via the seeding script (§6), each titled `[Exx-Tnn] <title>`,
  labeled, milestoned, and added to the project. Plus **20 epic tracking
  issues** (one per epic, `type:task`, pinned checklist of its task IDs) that
  live for the epic's whole life.
- **Rolling:** each milestone's issues are seeded when the _previous_ milestone
  reaches ~70% done — far enough ahead to schedule, close enough that the
  blueprint can still be corrected cheaply from what we learned. The blueprint
  files remain the backlog of record for unseeded milestones; the tracker is
  the record for seeded ones. On seeding, any drift (renumbered scope, learned
  estimates) is patched in the blueprint first, then seeded — the two are never
  allowed to disagree.
- **Community-facing issues** (`good-first-issue`, `help-wanted`) get an extra
  curation pass per E20-T01: reproduction, pointers, mentor named.

**Feature requests** arrive via the template (never the task template), start
`status:needs-triage`, and on acceptance are either (a) attached to an epic +
milestone like any task, or (b) sent to the RFC track if substantial
(template's scope-check question routes this early).

## 6. Seeding Commands (executable once the repo exists)

Milestones:

```bash
for m in "M0 Foundation" "M1 Identity preview" "M2 Control plane" \
         "M3 Revenue & delivery" "M4 Surface complete" "M5 1.0 hardened"; do
  gh api repos/africorex-ltd/Corestack/milestones -f title="${m%% *}" -f description="${m#* } — exit criteria: docs/engineering/00-OVERVIEW.md §6"
done
```

Labels (full set; idempotent):

```bash
# type:*
for l in bug:d73a4a feature:a2eeef task:c5def5 docs:0075ca rfc:8250df; do
  gh label create "type:${l%%:*}" --color "${l##*:}" --force; done
# area:*
for a in kernel platform tenancy auth rbac audit billing notifications jobs webhooks storage http cli client reference-app docs-site ci; do
  gh label create "area:$a" --color 1d76db --force; done
# prio / size / status / flag
for p in P0:b60205 P1:d93f0b P2:fbca04 P3:c2e0c6; do gh label create "prio:${p%%:*}" --color "${p##*:}" --force; done
for s in XS S M L XL; do gh label create "size:$s" --color bfdadc --force; done
for s in needs-triage needs-repro blocked ready in-progress needs-review; do gh label create "status:$s" --color ededed --force; done
for f in good-first-issue:7057ff help-wanted:008672 breaking-change:b60205 security-review:b60205 regression:e99695 launch-week:f9d0c4; do
  gh label create "flag:${f%%:*}" --color "${f##*:}" --force; done
```

Issue seeding: `tooling/scripts/seed-issues.ts` (task E01-T04 extension) parses
the blueprint tables (stable format: `| Exx-Tnn | … |`) and emits one
`gh issue create` per row with title/labels/milestone/body(AC + blueprint
link), then adds it to the project with field values. Dry-run mode prints the
plan; the script is idempotent (skips existing `[Exx-Tnn]` titles).

## 7. Automation

- **Label↔project sync:** Action mirrors `prio:`/`size:`/`status:` labels into
  project fields (single write path: labels win).
- **Task-ID enforcement:** Action verifies PR body links an issue or states
  `Task: N/A` — soft-fails with a comment, never blocks a drive-by docs fix.
- **Stale policy (humane):** only `status:needs-repro` auto-nudges (14 d) and
  auto-closes (30 d, with a reopen invitation). Triaged issues never auto-close
  — auto-closing real bugs is community poison.
- **Release automation:** per [09-release-versioning.md](09-release-versioning.md);
  milestone close → draft devlog checklist issue.
- **Security lane:** `flag:security-review` label pings the security rotation;
  weekly Security view review is a standing calendar item.

## 8. Feature Requests & RFC Flow

```
idea → Discussion (RFC category) → RFC PR (docs/rfc/NNNN) → FCP (7 days)
     → accepted → epic/task issues (+ ADR if architectural) → implementation
scoped idea → feature-request issue → triage → milestone or polite decline
```

Declines cite vision/architecture sections — "no with a reason and a link"
is the standard (the scope-discipline muscle, exercised publicly).

**Stop-line:** this plan plus the templates, governance, release, and
contribution documents complete the GitHub planning phase. Execution (repo
creation, seeding) awaits founder approval.
