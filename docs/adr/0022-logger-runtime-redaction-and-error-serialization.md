# ADR 0022: `Logger` adapters must redact sensitive fields and stably serialize errors at runtime

- **Status:** Accepted
- **Date:** 2026-07-29
- **Elaborated in:** `packages/kernel/src/logger.ts`, [security-scorecard.md](../security/security-scorecard.md), [docs/testing/contract-governance.md](../testing/contract-governance.md)

## Context

Building the `Logger` contract suite (E04 executable-behavioral-contracts
work, following E04-T01's framework) surfaced a real gap between what the
`Logger` port's doc comment claimed and what the shipped kernel exports
actually did.

**Finding 1 — no adapter redacted anything.** `logger.ts`'s port doc said
adapters "MUST redact" `SENSITIVE_LOG_KEYS` fields, but neither shipped
adapter did: `CaptureLogger#log` pushed `{ ...this.#bound, ...fields }`
straight into its `entries` sink with no filtering at all, and `NoopLogger`
discards everything unconditionally (trivially safe, but not evidence the
contract was implemented anywhere). Every document that actually describes
this codebase's sensitive-log security control — AUD-08,
`docs/quality/certifications/kernel-0.2.0-rc.md`, and
`docs/security/security-scorecard.md` — describes it as the static eslint
deny-list at call sites (`no-restricted-syntax` in
`tooling/eslint/index.mjs`) only. None of them claim adapter-level runtime
redaction exists. Two consistent stories in this codebase disagreed with
each other, and this was found before a real bug ever depended on it, the
same way the certification's own idempotency finding was.

**Finding 2 — `Error` values serialized to `{}`.** `Error.prototype`'s
`message` and `stack` are own but **non-enumerable** properties (verified
directly: `Object.getOwnPropertyDescriptor(new Error("x"), "message")`
reports `enumerable: false`). A plain object spread — exactly what
`CaptureLogger` did — or `JSON.stringify` therefore silently produces `{}`
for any field whose value is an `Error`. A caller logging
`logger.error("failed", { err })` got no error detail captured at all, no
error thrown, nothing to indicate data was lost.

## Decision

The static eslint deny-list catches literal field names at the call site
(`logger.info("x", { password: y })`) but cannot catch a field assigned via
a dynamic key (`logger.info("x", { [someKey]: y })` where `someKey`
evaluates to `"password"` at runtime) or a value nested inside an object a
caller passes as a single field. Runtime redaction is genuine
defense-in-depth the static rule cannot provide, not a redundant restatement
of it — so the port doc's original "MUST redact" claim is the correct one,
and the gap is in the adapters, not the doc.

**`redactSensitiveFields(fields: LogFields): LogFields`** (new kernel
export) walks the final, merged field set and replaces any
`SENSITIVE_LOG_KEYS` key's value with the literal string `"[REDACTED]"`,
returning a new frozen object — the input is never mutated.

**`serializeErrorForLog(error: Error): Readonly<Record<string, unknown>>`**
(new kernel export) destructures `name`/`message`/`stack` explicitly
(bypassing the non-enumerable problem) plus any other own-enumerable
properties a caller attached to the error (e.g. `err.code`), returning a
frozen plain object safe to spread, log, or `JSON.stringify`.

`CaptureLogger#log` now composes both: every value that is `instanceof
Error` is passed through `serializeErrorForLog` first, then the whole
merged field set is passed through `redactSensitiveFields`, before the
entry is pushed. `NoopLogger` needs no change — it captures nothing, so
there is nothing to redact or serialize, and it already vacuously satisfies
both contracts.

The port doc comment is corrected to describe this as the actual contract:
runtime redaction plus error serialization, defense-in-depth behind (not a
replacement for) the static lint rule.

## Consequences

**Breaking change to `CaptureLogger`'s captured output**, pre-1.0, no npm
publish has ever happened (`E02-T14` is RC-certified but publish-blocked on
external credentials — see `docs/quality/certifications/kernel-0.2.0-rc.md`),
so no real consumer's assertions break. Any test in this repo that asserted
a `SENSITIVE_LOG_KEYS` field or an `Error` value appeared verbatim in
`CaptureLogger.entries` would now see the redacted/serialized form instead
— none currently do (grepped before this change).

The future pino reference adapter (referenced in the port doc, not yet
built) must call both functions too — exporting them from the kernel rather
than inlining the logic in `CaptureLogger` means that adapter reuses the
exact same, already-tested behavior instead of reimplementing it.

## Alternatives considered

**Correct the port doc instead of the adapters** (treat the certifications'
"static-lint-only" story as the truth, drop the "MUST redact" claim).
Rejected: the static rule genuinely cannot catch a dynamic-key field
assignment or a nested object field, so relying on it alone leaves a real,
closeable gap open. The certifications describing only the static rule
reflects what was built, not a considered decision that runtime redaction
is unnecessary — nothing in the audit trail argues against defense-in-depth
here, and the founder confirmed runtime redaction should be normative when
this fork was surfaced during the contract-suite work.

**Leave `Error` fields as an opaque, unserialized pass-through** and
document "don't log raw `Error` objects, log `.message` yourself." Rejected:
this pushes a footgun onto every caller across every future module, for a
problem the port itself can solve once, centrally, for every adapter.
