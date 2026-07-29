# Snapshot Governance

- **Effort:** E04 Consolidation and Release-Hardening Mode, Section 4.
- **Scope:** every `toMatchSnapshot()` use in this repository. As of this
  writing that is exactly two files:
  `packages/kernel/test/api-surface.test.ts` (1 snapshot, the kernel's
  runtime export list) and
  `packages/platform/test/application/health-readiness.test.ts` (3
  snapshots, the `checkLiveness`/`checkReadiness` JSON payload shapes).

## What a snapshot in this codebase is for

A snapshot exists to force an **explicit, reviewable decision** at the
moment a public, structural surface changes shape — not to save the
effort of writing an assertion. Every snapshot in this repository asserts
*shape or membership* (what keys exist, in what nesting), never a value
that could plausibly be correct at more than one specific number or string.
Per-field, semantic assertions (does `checkReadiness` correctly report
`degraded` when the database is slow?) belong in ordinary `expect()`
assertions next to the snapshot, not folded into it — see
`health-readiness.test.ts`'s existing field-level tests, which the
snapshot block supplements rather than replaces.

## What MAY be snapshotted

- **Public export lists.** A sorted list of a package's runtime exports
  (`api-surface.test.ts`'s pattern) — the snapshot's only job is to make an
  added, removed, or renamed export show up as an explicit diff in review,
  never as a silent side effect of an unrelated change.
- **Structural payload shapes with deterministic content.** A JSON response
  shape is snapshot-eligible only when every value in it is deterministic
  under test — a `FixedClock` timestamp, a fixed set of configured checks,
  no random ids, no wall-clock `Date.now()`. `health-readiness.test.ts`
  qualifies because every check function it snapshots takes injected,
  fixed inputs.
- **A deliberately small, closed set of variants.** Three snapshots
  (minimal, fully-configured, liveness) is a considered choice, not "one
  snapshot per test." A snapshot suite that grows unboundedly (one new
  snapshot per new optional field's every combination) has stopped forcing
  a reviewable decision and started being noise — see the review checklist
  below.

## What MUST NEVER be snapshotted

- **Anything containing a secret, credential, API key, or PII.** No
  exception. A snapshot file is committed to the repository in plaintext,
  reviewed casually, and diffed automatically — the worst possible place
  for anything sensitive to leak into, and the easiest place for it to slip
  through unnoticed (a snapshot diff is often skimmed, not read field by
  field).
- **Anything a redaction contract governs.** `Logger`'s
  `SENSITIVE_LOG_KEYS`/`redactSensitiveFields` (ADR-0022) exist specifically
  so sensitive fields never appear in captured log output; snapshotting
  `CaptureLogger`'s `entries` would be redundant with the contract suite at
  best and a redaction bypass at worst if the snapshot were ever taken
  before redaction ran. No `Logger` snapshot exists today, and none should
  be added without re-reading ADR-0022 first.
- **Non-deterministic content.** Anything containing a real UUID generated
  at test time, an un-fixed `Date.now()`, or output whose field order isn't
  guaranteed (unsorted object key iteration across a `Map`/`Set`) — a
  snapshot over non-deterministic content produces spurious diffs that
  train reviewers to `-u` without reading, defeating the entire mechanism.
- **Behavior that a contract suite already governs.** Cache eviction order,
  RateLimiter bucket state, EventBus delivery order — these have dedicated,
  semantic assertions in their contract suites (see
  `contract-governance.md`). Snapshotting the same behavior on top would
  create two sources of truth that can drift from each other silently.

## Update procedure

1. Run the failing test and read the **diff vitest prints**, not just the
   pass/fail result — `vitest -u` only regenerates the file, it does not
   tell you whether the change was intentional.
2. Confirm every changed/added/removed line in the diff corresponds to a
   change you made deliberately in this same change set. If a snapshot
   diff surfaces something you didn't intend to change, that is a bug
   report, not a prompt to update the snapshot.
3. Run `vitest -u` (or the package's `test -- -u` script) to regenerate.
4. State in the commit message what changed and why, the same convention
   this repository's CHANGELOG entries already follow (see ADR-0022's
   commit for the template: kernel's `api-surface.test.ts.snap` update was
   called out explicitly as "two new exports, both intentional").
5. Never batch a snapshot update into an unrelated commit — a reviewer
   should be able to see "snapshot changed" and "why" in the same diff.

## Review checklist (for whoever reviews a PR touching a snapshot)

- [ ] Does every line that changed in the snapshot correspond to a change
      described in the PR?
- [ ] Does the new/changed content contain anything that looks like a
      secret, token, real email, or real name that isn't an obvious test
      fixture (`ada@example.com`-style values are fine; anything that looks
      like it leaked from a real system is not)?
- [ ] If a new key was added to a payload shape, is there also a semantic
      `expect()` assertion for that key's *value* somewhere in the same
      file, not just its presence in the snapshot?
- [ ] If the PR touches `Logger` or any redaction-adjacent code, confirm no
      new snapshot was introduced over captured log entries (see "What MUST
      NEVER be snapshotted," above).
- [ ] Is the total snapshot count for the file still small and enumerable
      (a human can read every snapshot in the file in under a minute)? If
      not, the suite may have drifted from "a few structural variants" to
      "one snapshot per test case" — flag it for a scope review.

## Breaking-change policy

A snapshot change that **removes or renames** a previously-present export
or field is a breaking change to that surface and follows the same rule
`contract-governance.md` already states for contract suites: it needs an
ADR if the change is behavioral (not just additive), a CHANGELOG entry
under this repository's breaking-change convention, and a check of existing
callers that could depend on the removed surface, with the result of that
check stated in the ADR or commit message. A snapshot change that only
**adds** a new export or field is additive and needs no ADR — the same
distinction `contract-governance.md`'s "When a contract change is
breaking" section draws for contract suites.

## Applying this policy to existing snapshots

Both existing snapshot files were audited against this policy as part of
writing it:

- **`packages/kernel/test/__snapshots__/api-surface.test.ts.snap`** — a
  sorted list of runtime export names. No secrets, no non-deterministic
  content (export names are static). Compliant.
- **`packages/platform/test/application/__snapshots__/health-readiness.test.ts.snap`**
  — three JSON payload shapes, every value built from `FixedClock` and
  fixed-input check functions (no live `Date.now()`, no generated ids in
  the payload itself). No secrets. Compliant.

No changes were needed to either file as a result of this policy — both
were already built the way this document now requires, since the
constraints above were the same ones applied when each was written. This
audit exists so future additions have a written standard to be checked
against, not because either existing snapshot violated one.
