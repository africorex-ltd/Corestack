# Contributing to CoreStack

Thanks for your interest in CoreStack. This document is the contributor's
operating manual: workflow, branching, review policy, and ground rules.
Governance (roles, decision-making) lives in [GOVERNANCE.md](GOVERNANCE.md);
release mechanics in [docs/engineering/09-release-versioning.md](docs/engineering/09-release-versioning.md).

## Ground rules

- **Architecture first.** Module boundaries, public APIs, ports, and
  infrastructure choices are governed by the ADRs and design docs in `docs/`.
  Changes to them start as an RFC/ADR, not a PR with code.
- **The dependency rule is non-negotiable** (Architecture §4) and machine-
  enforced by lint. Don't fight the boundary rules; if one seems wrong, open a
  discussion.
- **Every behavior change ships with tests** per its category standard
  ([blueprint §4](docs/engineering/00-OVERVIEW.md)) — domain logic without I/O,
  adapters against real infrastructure via the contract suites.
- **Security defaults are not configurable footguns.** A PR that makes the
  insecure path the easy path will not merge.
- **No new runtime dependency without written justification** in the PR.
- **No new features while unresolved P0 findings exist** — the
  [quality dashboard](docs/quality/dashboard.md) is the gate of record;
  remediation always outranks features.
- **DCO:** sign off every commit (`git commit -s`). No CLA (inbound=outbound,
  MIT).

## Getting started

```bash
pnpm install
pnpm build && pnpm test          # unit + application (< 30 s budget)
pnpm test:integration            # needs Docker (Testcontainers)
```

Pick a `flag:good-first-issue` if you're new — each one has a named mentor.
Comment to claim it; don't sit on claims > a week.

## Contribution workflow

1. **Find or file the work item.** Bugs need the bug template (repro
   required); scoped features use the feature template; substantial ideas go
   to the RFC track first. For blueprint tasks, comment on the issue to claim.
2. **Branch** from `main` (see Branching below). Fork if you're not a
   maintainer.
3. **Implement** with tests + docs per the category standard. Keep PRs
   scoped to one task/issue — reviewers may ask you to split.
4. **Open the PR** using the template: link the task/issue, complete the
   checklist honestly, add a changeset if a published package changed.
5. **Review cycle** (policy below). Address feedback with new commits (no
   force-push during review — it breaks reviewer diffs; squash happens at
   merge).
6. **Merge** via the merge queue once approved and green. Squash-merge only;
   the PR title becomes the commit (conventional-commit format enforced).

## Branching strategy

**Trunk-based.** `main` is the only long-lived branch and is always releasable.

- **Branch names:** `feat/E05-T17-invite-member`, `fix/1234-session-expiry`,
  `docs/…`, `chore/…` — type, then task/issue ref, then slug.
- **Short-lived:** target < 3 days of divergence; rebase on `main` before
  requesting review. Long-running work lands as a sequence of small,
  individually-shippable PRs behind config/entitlement gates — not as a
  months-old branch.
- **No develop / release branches pre-1.0.** Post-1.0, `release/1.x`
  maintenance branches exist solely for security backports (automation:
  blueprint E19-T20).
- **Releases are tags** on `main` created by the Changesets pipeline; humans
  don't hand-tag.

## Code review policy

- **Every change reaches `main` through a reviewed PR.** No direct pushes, no
  self-merge — _including maintainers and the founder_. Emergency security
  fixes still get review (a second security-rotation member), just faster.
- **Approvals:** one maintainer approval for routine changes. **Two approvals,
  at least one from the security rotation**, for anything labeled
  `flag:security-review` (auth flows, tenant isolation, secrets, crypto,
  RLS, CI/release pipeline). CODEOWNERS enforces routing.
- **What reviewers check, in order:** (1) acceptance criteria of the linked
  task are met; (2) category standard satisfied (tests, docs); (3) boundary
  and security rules; (4) public-surface changes have a changeset with honest
  notes; (5) readability — code is written for the next decade's reader.
  Style nits below the linter's radar are suggestions, not blockers.
- **Review SLA:** first response within 3 working days (community PRs are a
  priority — a stale first PR is a lost contributor). If a review stalls,
  escalate in the triage rotation, not by pinging individuals.
- **Disagreements** are resolved by the review comments' technical merits;
  unresolved → module maintainer decides; cross-module → GOVERNANCE.md
  decision ladder.
- **AI-assisted contributions** are welcome and held to the identical
  standard; you own what you submit — "the tool wrote it" is not a review
  response.

## Commit style

Conventional Commits, scoped by package: `feat(tenancy): …`, `fix(auth): …`,
`docs:`, `chore(ci):`. The PR title (which becomes the squash commit) must
follow this; commitlint enforces it.

## Questions

GitHub Discussions → Support. Real-time chat channels are linked from the
README. Be kind; assume good faith; see CODE_OF_CONDUCT.md.
