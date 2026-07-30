import { defineConfig } from "vitest/config";

/**
 * Integration-only Vitest config (E05-T11) — the first real consumer of
 * `pnpm test:integration` this package has had. `vitest.config.ts`'s own
 * `exclude` list deliberately skips `test/integration/**` for every
 * ordinary `vitest`/`vitest run` invocation (so an editor-direct run
 * never accidentally tries to hit a real database) — but Vitest's CLI
 * `--exclude` flag *adds to* a config file's `exclude` list rather than
 * replacing it, so passing `test/integration` as a path filter on the
 * command line cannot override that exclude (confirmed empirically while
 * wiring this task's first integration test: `vitest run test/integration`
 * reported "No test files found" until this file existed). This is a
 * separate config, not a CLI override, specifically to include
 * `test/integration/**` instead of trying to un-exclude it.
 */
export default defineConfig({
  test: {
    include: ["test/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
