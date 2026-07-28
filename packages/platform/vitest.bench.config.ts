import { defineConfig } from "vitest/config";

// Deliberately separate from the default vitest CLI include glob (which
// only matches *.test.*/*.spec.* files) so bench files can never be
// picked up by the "test" or "test:integration" scripts, and can only run
// via the explicit "bench" script below. See bench/harness.ts.
export default defineConfig({
  test: {
    include: ["bench/**/*.bench.ts"],
  },
});
