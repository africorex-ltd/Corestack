# Maintainer Release Checklist

- **Effort:** E05 Readiness Gate, Section 6.
- **Scope:** what a maintainer actually needs to do to cut a real release
  train, given this repository's current (largely unexercised) release
  tooling. Written honestly against what exists today, not against the
  aspirational process `09-release-versioning.md` describes — several
  items below are gaps in that process's actual execution, not the
  process's design.

## Before the train departs

- [ ] **Reconcile the changeset backlog.** `docs/engineering/
      09-release-versioning.md` mandates a changeset per PR touching a
      published package; in practice, only **one** changeset exists in
      `.changeset/` today (`kernel-contract-surface.md`, describing an
      early snapshot of the kernel's port surface). Every subsequent
      change — the entire E03 platform build-out, the E04 contract-suite
      effort, this readiness gate — shipped without one. Before a real
      release, either: (a) write a consolidated changeset covering
      everything since the last one, accepting it won't have per-PR
      granularity, or (b) treat this alpha as "no changeset-driven
      version bump," hand-picking `0.1.0-alpha.1` for both packages
      directly. Decide explicitly; don't let Changesets silently compute
      a version from an incomplete history.
- [ ] **Decide the kernel version-numbering question.** Kernel's internal
      certification names it "0.2.0-rc"; this release's draft notes use
      `0.1.0-alpha.1` for consistency with platform. Pick one and update
      whichever doc is now stale.
- [ ] **Confirm `RELEASE_ENABLED`.** The release pipeline is gated on this
      repo variable, itself gated on having an npm org + token — both
      external prerequisites, not something this checklist can complete
      from inside the repo.
- [ ] **Re-verify every number in the release notes against `main` at the
      actual tag commit**, not against this document. Test counts,
      certification dates, and ADR counts drift; this repo's own standing
      discipline is measure, don't estimate — apply it here too.
- [ ] **Confirm CI is green on `main`** at the commit being tagged —
      `pnpm -r build && pnpm -r typecheck && eslint . && pnpm -r test`
      plus the architecture-fitness suite, all passing.
- [ ] **Confirm the integration lane passes**, either against a real
      Postgres instance or Testcontainers — see
      `docs/testing/testcontainers-readiness.md` if only the latter is
      available and untested in this exact environment.

## At release time

- [ ] Tag `v0.1.0-alpha.1` (or whatever version was decided above) on
      `main`.
- [ ] Publish via the gated pipeline (never manually `npm publish` — the
      versioning doc's provenance-attested, CI-only publish requirement
      exists specifically to prevent that).
- [ ] Create the GitHub release from
      [v0.1.0-alpha.1-github-release-draft.md](v0.1.0-alpha.1-github-release-draft.md),
      after re-verifying its numbers per the pre-departure step above.
- [ ] Mark it as a **pre-release** on GitHub — this is an alpha, and the
      "recommended audience" section of the release notes is explicit
      that this isn't for production use.

## After the train departs

- [ ] Update `docs/quality/dashboard.md`'s header to note the real
      publish date and version, distinct from the internal
      certification dates already there.
- [ ] Update `packages/kernel/README.md`'s "Status: Release Candidate"
      banner if the kernel's public version now supersedes it, or clarify
      how the two coexist if not.
- [ ] Open a tracking item for the next train's changeset discipline —
      don't let the backlog identified above recur; if `pnpm changeset`
      isn't being run per-PR going forward, this same reconciliation
      problem repeats at the next release.
- [ ] File the follow-up items this readiness gate identified as **not**
      blocking this release but real: the RLS-DDL codegen bridge gap
      (`e05-readiness-friction-log.md` step 6), the module scaffold gap
      (naturally closes with E05-T01), and `UnitOfWork`'s deliberately
      deferred mutation proof (revisit only if a real implementation
      hazard surfaces, per `contract-coverage-audit.md`).

## What this checklist deliberately does not cover

Per-package Changesets version-bump mechanics (major/minor/patch
selection), npm org administration, and provenance-attestation setup are
all covered by Changesets' own documentation and this repo's CI workflow
files directly — this checklist is the CoreStack-specific judgment calls
layered on top of that generic tooling, not a replacement for reading it.
