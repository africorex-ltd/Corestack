# ADR 0016: `@corestack/platform` is a second shared dependency base, alongside the kernel

- **Status:** Accepted
- **Date:** 2026-07-28
- **Elaborated in:** [Architecture §47](../architecture/ARCHITECTURE.md), [decision 0001](../decisions/0001-platform-package.md), [ADR-0002](0002-pnpm-turborepo-monorepo.md), [ADR-0014](0014-module-lifecycle-contract.md)

## Context

Architecture §47's package-dependency diagram states modules depend "ONLY on
kernel," with cross-module coupling forbidden except for typed contract
subpaths. That rule was written before `@corestack/platform` existed as a
concrete package — but the engineering blueprint (E03) already named
`@corestack/platform` as the home for the migration engine, transactional
outbox, and `createCoreStack()` composition helper (decision 0001,
2026-07-28), all of which every module needs. §47's diagram simply never
depicted this package, creating a latent contradiction: the architecture
fitness suite's cross-package test (governance §7.1) enforced the literal
"kernel-only" wording, which would incorrectly block every future module
from depending on `@corestack/platform` the moment one tried to.

## Decision

`@corestack/platform` is a **second permitted shared dependency base**.
Modules may depend on `@corestack/kernel` and `@corestack/platform`, but
never on each other (unchanged) or on any other module's internals.
`@corestack/platform` itself may depend **only** on `@corestack/kernel` —
it does not get to depend on modules, preserving the inward-only shape of
the graph:

```
                          @corestack/kernel
                                 ▲
                          @corestack/platform (composition root, migrations,
                                 ▲              outbox — I/O-capable, unlike kernel)
        ┌──────────┬─────────┬───┴────┬──────────┬─────────────┐
      auth      tenancy    rbac    billing     audit    notifications/jobs/webhooks
        ▲          ▲         ▲        ▲          │  (modules depend ONLY on kernel
        └──────────┴────┬────┴────────┘          │   + platform; cross-module =
                        │                        │   events + ids, never package
                @corestack/cli, @corestack/client, apps/reference-nextjs   imports*)
                (composition consumers — may depend on any module)
```

The `/contracts` typed-subpath exception (Architecture §47's asterisk note)
is unchanged.

## Alternatives considered

- **Fold platform's responsibilities into the kernel:** rejected already,
  for the same reason decision 0001 gave — the kernel's charter is
  zero-dependency and runtime-agnostic; migrations and the outbox need
  Node/SQL and must not compromise that.
- **Leave the diagram as "kernel-only" and give platform special-cased,
  undocumented treatment:** rejected — an unwritten exception is exactly
  the kind of drift this project's documentation discipline exists to
  prevent; the fitness suite must encode what's actually true.

## Consequences

- Architecture §47 and the cross-package fitness test
  (`architecture-tests/test/cross-package.test.mjs`) are updated together
  in the same change, so the enforced rule and the documented rule never
  diverge.
- Every future module's `package.json` legitimately lists both
  `@corestack/kernel` and `@corestack/platform` as dependencies without
  tripping the fitness suite.
