# Kernel Certification Review — @corestack/kernel → Release Candidate

- **Date:** 2026-07-28 · **Certifier:** Engineering (autonomous mode)
- **Scope:** `@corestack/kernel` at post-remediation state (pending version:
  0.2.0 via open changeset). Trigger: all P0 audit findings resolved
  (governance §6).

## Verification

| Criterion                     | Evidence                                                                                                                                                                                                                       | Verdict  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| **Public API**                | Runtime surface snapshot-gated (`api-surface.test.ts`); surface reviewed export-by-export this cycle; exports map is the semver perimeter (types-first conditions, fitness-verified)                                           | ✅       |
| **ADR compliance**            | ADR-0001: pure-ES2022 compile, no Node/DOM libs, ESM-only (fitness-tested); ADR-0009 semantics **corrected and regression-locked** (AUD-02/03); UUIDv7 per DB rule 2                                                           | ✅       |
| **Architecture compliance**   | Layer lint zones + 12 fixture tests; import-cycle fitness test; no business meaning in any export (reviewed)                                                                                                                   | ✅       |
| **Package boundaries**        | Cross-package fitness suite: no internal deep-imports, no relative escapes, kernel-only runtime deps between @corestack packages                                                                                               | ✅       |
| **Security**                  | Secrets doctrine embodied (Encrypter detail-free failures, verify-only-vs-use-again split documented); `SENSITIVE_LOG_KEYS` mechanically synced with lint (AUD-08); envelopes frozen (AUD-10); limiter memory bounded (AUD-05) | ✅       |
| **Performance**               | No hot-path regressions possible yet (no benchmarks exist) — **deviation, justified:** harness is E04-T13; kernel hot paths (id gen, freeze, bus dispatch) are allocation-light by construction                                | ⚠️ noted |
| **Documentation**             | README surface table current; every export TSDoc'd; normative semantics in port TSDoc (the E04 contract-suite source)                                                                                                          | ✅       |
| **Zero runtime dependencies** | `dependencies`/`peerDependencies` absent — **fitness-test-enforced**, not just true today                                                                                                                                      | ✅       |
| **Upgrade compatibility**     | Pre-first-publish: no consumers to break; changeset documents the v4→v7 id change; semver machinery (Changesets + gated pipeline) live                                                                                         | ✅       |
| **Test coverage**             | 66 tests · 97.7% stmts · 98.2% branch · 90.7% funcs (target ≥90% met); uncovered: noop-logger bodies, clock-backwards branch, one unreachable guard                                                                            | ✅       |

## Deviations (justified, tracked)

1. Benchmark evidence pending E04-T13 (dashboard debt register).
2. Actual npm publish blocked on external credentials (stop condition,
   flagged to founder) — RC status is engineering-complete, not published.

## Verdict

**CERTIFIED — Release Candidate.** `@corestack/kernel` is RC quality:
behaviour matches the ADRs exactly (with regression tests standing guard),
the surface is gated, and the package is publish-ready the moment
credentials exist. E03 may resume (governance §9).
