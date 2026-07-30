import { defineConfig } from "vitest/config";

/**
 * The first bare `vitest.config.ts` in this repo (E05 readiness-gate
 * friction log, step 1: `examples/acme-crm-module` has no config file at
 * all, only CLI flags baked into package.json scripts). Every other
 * package's unit/integration split lives entirely in its `test`/
 * `test:integration` script strings; this file moves that split into
 * config instead, so `vitest` run directly (no npm script, e.g. from an
 * editor integration) still honors it. This is the new module convention
 * E05-T29 propagates to the module template — not a one-off for Tenancy.
 */
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/test/integration/**"],
  },
});
