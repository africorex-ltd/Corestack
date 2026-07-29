# Engineering Health Report — Tenant Isolation Certification

- **Date:** 2026-07-29 · **Mode:** Platform Maturity — Security Certification
- **Trigger:** T30/T31/T33 accepted; before any new feature work or E04
  expansion, per the founder's certification request.
- **Full detail:** [tenant-isolation-certification.md](../../security/tenant-isolation-certification.md) ·
  [security-scorecard.md](../../security/security-scorecard.md) ·
  [v0.1.0-alpha-readiness.md](../../releases/v0.1.0-alpha-readiness.md)

## What shipped

| Deliverable                                                            | Status                                                                                                         |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Per-layer security audit (12 components)                               | Done — [certification §1](../../security/tenant-isolation-certification.md#1-per-layer-audit)                  |
| Empirical PostgreSQL 18 fail-closed findings                           | Done — [certification §3](../../security/tenant-isolation-certification.md#3-empirical-findings-postgresql-18) |
| Regression test matrix (14 scenarios)                                  | Done — 6 new tests across 3 existing suites, each proven against an unsafe variant                             |
| Architecture fitness rules (`GlobalRepository`, platform-table access) | Done — ADR-0021, 2 rules automated + 3 downgraded to reviewed convention with a stated reason                  |
| Contributor safety guide                                               | Done — `docs/security/how-to-build-a-tenant-safe-feature.md`                                                   |
| Golden-path example module                                             | Done — `examples/acme-crm-module`, 7 integration/unit tests, real end-to-end proof                             |
| Security scorecard                                                     | Done — 10 dimensions, range 5–8/10                                                                             |
| Alpha readiness review                                                 | Done — `docs/releases/v0.1.0-alpha-readiness.md`                                                               |
| Final verdict                                                          | **CERTIFIED WITH RESIDUAL RISKS**                                                                              |

## The one real finding

A genuine cross-tenant vulnerability was found in `IdempotencyStore`
(T43, shipped earlier this session): the port keyed purely on
`(scope, key)`, and since `key` is a client-supplied `Idempotency-Key`
header value, two organizations presenting an identical `(scope, key,
requestHash)` could cause one to replay the other's stored response.
Verified as a failing test against the as-shipped code, then fixed —
`organizationId` is now a mandatory, structural port parameter (ADR-0020).
No real caller existed yet for this port, so this was caught before any
production exposure — but it's recorded as a resolved P0 in the quality
dashboard for an honest audit trail, not swept aside because it was
caught in time.

## Test delta

| Suite                  | Before |  After  |  Delta  |
| ---------------------- | :----: | :-----: | :-----: |
| Kernel                 |   74   |   76    |   +2    |
| Platform (unit)        |  191   |   191   |    0    |
| Platform (integration) |   80   |   88    |   +8    |
| Architecture fitness   |   16   |   26    |   +10   |
| Lint-config fixtures   |   14   |   15    |   +1    |
| Example module (new)   |   —    |    7    |   +7    |
| **Total**              |  375   | **403** | **+28** |

(Kernel/platform "before" figures reflect the state immediately after
E03-T43 shipped, i.e. before this certification pass began — matching the
E03-exit-report.md snapshot.)

## Verdict

**CERTIFIED WITH RESIDUAL RISKS.** Four residual risks ranked and given
concrete remediation tasks (full detail in the certification document
§7). The highest-priority one, R3, is that no real deployment has ever
connected to Postgres as the restricted RLS `app`/`platform` roles — the
mechanism is proven correct in isolation but not yet proven live. This is
a pre-existing gap restated (not newly introduced) through T30/T31/T40
and now formally tracked as the top item to resolve before any real
deployment.

## Next

Per the trigger's own instruction: resume the Engineering Blueprint at
the next pending E04 task. E04-T01 (contract-suite framework) is
unblocked. **E04-T02 (Testcontainers harness for Postgres/Redis/MinIO)
needs Docker, which is unavailable on this development machine** — the
same constraint already documented in ADR-0018. This will be flagged
again when reached rather than silently attempted.
