# ADR 0001: TypeScript on Node.js, ESM-only

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

CoreStack targets teams building SaaS products. We need a language and runtime with
a huge hiring pool, a mature ecosystem for every integration a SaaS needs (payments,
email, OAuth providers), and strong static guarantees for a security-critical
codebase that thousands of developers will depend on.

## Decision

- **TypeScript** in `strict` mode (plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`) for all packages.
- **Node.js ≥ 20.11 (LTS)** as the supported runtime floor.
- **ESM-only** (`"type": "module"`). No dual CJS/ESM builds: dual packaging doubles
  the maintenance surface and is the leading cause of subtle resolution bugs. The
  ecosystem (Vitest, Next.js, modern bundlers) is ESM-native in 2026.

## Consequences

- Broadest possible contributor and adopter base among SaaS teams.
- CJS-only consumers must use dynamic `import()`; we accept this trade-off.
- Runtime-agnostic core: nothing in domain/application layers may use Node builtins,
  keeping the door open for edge runtimes and Bun without committing to them now.
