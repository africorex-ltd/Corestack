# Staff Engineer Audit — 2026-07-28

- **Scope:** entire repository at commit `bfe4f64` (end of E02), reviewed
  fresh-eyes: architecture, code, tooling, CI, security posture, docs.
- **Method:** every claim below was verified against the actual files/build
  artifacts, not the design docs' description of them. One suspicion was
  disproved this way (AUD-N1) and is recorded to show the method works.
- **Verdict up front:** the foundation is genuinely sound — boundary rules
  are machine-enforced and fixture-tested, the outbox-first event design is
  right, the kernel is zero-dependency with a snapshot-gated surface, and
  scope discipline is written down and enforced. The findings below are
  real but proportionate: **two semantic bugs in reference implementations,
  two CI-integrity gaps, and a cluster of publish-readiness and
  doc-consistency issues.** Nothing requires architectural change.

## 1. Findings

### P0 — fix before any E03 feature work

**AUD-01 · CI integrity: the integration lane is a green no-op.**
`.github/workflows/ci.yml` runs `pnpm test:integration` and is positioned as
a required check, but **no package defines a `test:integration` script** —
turbo matches zero tasks and the job passes vacuously. A required check that
cannot fail is worse than no check: it manufactures false confidence
(exactly the failure mode the unskippable-isolation-suite philosophy exists
to prevent). _Fix:_ guard script that fails the job when zero tasks matched,
with an explicit allowlist window until E03-T02 lands the first real
integration suite.

**AUD-02 · Reference-semantics bug: `idempotentHandler` marks before
handling.** A handler failure after `markIfNew` permanently loses the event
for that consumer under the in-memory store — the reference implementation
of an _at-least-once_ building block silently encodes _at-most-once_.
Since E04's contract suites will be generated from reference semantics, this
would fossilize the wrong contract. _Fix:_ mark **after** successful
handling in the reference (redelivery-safe), TSDoc keeps the stronger rule
for durable adapters (mark atomically with effects, in-tx), failure-path
tests added.

**AUD-03 · Reference-semantics divergence: `InMemoryUnitOfWork` fails the
use case when a consumer fails.** Staged events dispatch synchronously in
`run()`; a throwing subscriber rejects the use case _after_ its state change
has logically committed. Production semantics (ADR-0009: outbox relay,
after-commit, isolated consumers) mean **consumer failures never fail the
producer**. The reference must match or every application test written
against it will encode wrong expectations. _Fix:_ isolate dispatch failures
(swallow into an optional `onDispatchError` sink; default: silent, matching
relay behavior), tests updated.

**AUD-04 · Live release workflow without publish credentials + un-pinned
actions.** The Changesets workflow now runs on every push to a public repo:
it will open a Version PR and _fail_ any publish attempt until `NPM_TOKEN`
exists — noisy, and a failing pipeline trains people to ignore red. All
workflows also use tag-pinned (not SHA-pinned) actions — the blueprint
scheduled SHA-pinning (E01-T05) for later, but the workflows went live at
repo creation, so the mitigation must move up. _Fix:_ gate the release job
on a `RELEASE_ENABLED` repository variable; SHA-pin every action now.

### P1 — fix before kernel publish / E04 contract-suite freeze

**AUD-05 · `InMemoryRateLimiter` leaks memory.** The window map is
unbounded and never pruned; positioned as the production single-node
adapter, that's a slow leak keyed by IP/email — an attacker-influencable
allocation. _Fix:_ opportunistic pruning of expired windows + entry cap.

**AUD-06 · Kernel publish-readiness gaps.** `package.json` lacks
`engines`, `repository`, `keywords`; description is stale (predates the
contract surface); no per-package LICENSE file in the tarball. All cheap;
all should precede E02-T14.

**AUD-07 · Fixed-window limiter permits 2× burst at window boundaries.**
Acceptable for general API limits; **not** ideal for credential-stuffing
brakes (per-email login/reset buckets). Decision needed at E06 design time
(sliding-window or token-bucket for auth-critical buckets) — recording it
now so it's a designed choice, not a discovery in a pentest.

**AUD-08 · Duplicated "single source" deny-lists.** `SENSITIVE_LOG_KEYS`
(kernel) and the eslint sensitive-log regex are hand-maintained twins that
both claim shared identity by convention. Convention drifts. _Fix:_ an
equivalence test in `tooling/eslint` that parses the rule's regex and
asserts set-equality with the kernel list.

**AUD-09 · `CaptureLogger` readonly-cast hack.** Child construction
reassigns a `readonly` field through a cast — works, but it's the kind of
cleverness the project's own principles ban. _Fix:_ explicit shared-sink
constructor shape.

**AUD-10 · Envelope immutability is convention-only.** `Context` and
`DomainEvent` are typed readonly but not frozen; a consumer can mutate a
shared event object and corrupt later consumers. _Fix:_ `Object.freeze` in
the factories (cheap; payload deep-freeze documented as consumer duty).

**AUD-11 · Stale/overlapping intro doc.** `docs/architecture/overview.md`
predates ARCHITECTURE.md: it still lists the EventBus as "(next)", and its
"repository layout" omits current reality. Two overlapping normative-ish
intros violate the documentation map's one-source-per-fact rule — _our own
rule._ _Fix:_ rewrite overview.md as a thin, dated summary pointing into
ARCHITECTURE.md.

### P2 — schedule (mapped into blueprint tasks)

| ID     | Finding                                                                                                                                                                            | Disposition                                                                                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-12 | No **cross-package** boundary lint (deep `@corestack/x/dist` imports, relative reach-across `../../tenancy/src`, contracts-subpath types-only rule of Architecture §47 unenforced) | New subtask **E01-T02.4**, must land before the second package (E05 gate)                                                                                                             |
| AUD-13 | `pnpm audit` as a PR-blocking gate = advisory-noise breakage with no remediation path in-PR                                                                                        | Move audit to the nightly/scheduled lane + Renovate; PR lane keeps CodeQL (amends E01-T10)                                                                                            |
| AUD-14 | `turbo test` depends on `^build` though unit tests run from `src` — wasted CI minutes                                                                                              | Measure, then split `test` (no build dep) vs `test:integration` (keeps it); fold into E04-T12 budget work                                                                             |
| AUD-15 | `versionedKey` has no delimiter discipline (`:` collisions between namespace/key theoretically forgeable)                                                                          | Document reserved characters in TSDoc + validation; fold into E04-T03 cache suite                                                                                                     |
| AUD-16 | Coverage claims (≥90%) not yet CI-enforced                                                                                                                                         | Already scheduled (E04-T11); until then the number is aspiration — say so in CONTRIBUTING                                                                                             |
| AUD-17 | Bus factor = 1: one person holds GitHub org, npm scope (pending), and the only dev machine                                                                                         | Organizational, not code: GOVERNANCE's ≥2-custodian rule is currently unmeetable; revisit at first maintainer addition; interim: verify GitHub org recovery codes + repo export exist |
| AUD-18 | Windows contributors get CRLF warning noise despite `.gitattributes`                                                                                                               | One line in CONTRIBUTING (`git config core.autocrlf false`)                                                                                                                           |
| AUD-19 | ~40k words of normative design vs ~1.5k LOC — drift risk as implementation teaches                                                                                                 | Process mitigation exists (blueprint-patch-before-seeding); _add_ a doc-diff pass to every epic-exit checklist so drift is caught per epic, not per milestone                         |

### Disproved during audit (recorded deliberately)

**AUD-N1:** Suspected that `WebCryptoAesGcmEncrypter`'s private constructor
leaked the ambient `MinimalCryptoKey` type into published declarations,
breaking consumers without `skipLibCheck`. **False** — verified against
`dist/encrypter.d.ts`: TypeScript erases private-constructor parameter
types (`private constructor();`). No action.

## 2. What is sound (explicitly)

Layer boundaries machine-enforced **and** fixture-tested; transactional
outbox as the event backbone (right call, correctly reasoned in ADR-0009);
zero-dependency runtime-agnostic kernel with an export snapshot gate;
secrets doctrine coherent across DB design, kernel, and lint; scope
refusals written down with reasons (the strongest anti-rot asset this
project has); commit/CI/release discipline live from the first commit.

## 3. Prioritised Remediation Plan

| Order                                                                   | Items                                                                                                                                                                                | Effort | Gate                                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------- |
| **Batch 1 (immediately, before E03)**                                   | AUD-01, 02, 03, 04                                                                                                                                                                   | ~1 day | Blocks all feature work — CI truthfulness and reference-semantics correctness are load-bearing |
| **Batch 2 (this milestone, before E02-T14 publish & E04 suite freeze)** | AUD-05, 06, 08, 09, 10, 11                                                                                                                                                           | ~1 day | Blocks kernel publish and contract-suite generation                                            |
| **Batch 3 (scheduled into blueprint)**                                  | AUD-07 → E06 design; AUD-12 → E01-T02.4 (E05 gate); AUD-13/14 → CI amendments; AUD-15 → E04-T03; AUD-16/18 → doc lines; AUD-17 → governance watch item; AUD-19 → epic-exit checklist | folded | Tracked in the blueprint files, not a parallel list                                            |

No finding requires an ADR change; AUD-02/03 _protect_ ADR-0009's semantics
rather than altering them. Remediation Batch 1 begins next cycle; no new
features until it's green.
