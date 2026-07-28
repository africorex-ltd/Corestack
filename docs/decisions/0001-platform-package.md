# 0001 — Create `@corestack/platform` rather than growing the kernel

- **Date:** 2026-07-28 · **Scope:** E03 · **Maturity §2 questionnaire applied**

**Context.** E03's components (migration engine, outbox relay, composition
root, RLS harness) need Node builtins (fs, crypto, timers) and eventually SQL.
The kernel's charter forbids all of that (runtime-agnostic, zero deps,
stability-first as of RC).

**Decision.** New publishable package `@corestack/platform` owns platform
infrastructure. Kernel answer to the §2 questionnaire: _can this live outside
the kernel?_ — yes, entirely; the kernel keeps only the ports these
components implement. Runtime-dependency budget: ≤ 4 (zod, drizzle-orm,
postgres driver as optional peers where adapter-scoped, per ADR-0010).

**Alternatives.** Growing the kernel (violates charter); per-component
micro-packages (proliferation, rejected by §11.4); folding into future `cli`
(wrong layer — CLI is an interface over this).

**Consequences.** Modules depend on kernel + (at composition time) platform;
platform is the second entry in the manifest fitness rules and the first
package with a real integration-test manifest entry when its Postgres
adapters land.
