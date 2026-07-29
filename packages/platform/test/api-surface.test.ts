import { describe, expect, it } from "vitest";

import * as platform from "../src/index.js";
import * as platformPostgres from "../src/postgres/index.js";
import * as platformTesting from "../src/testing/index.js";

/**
 * Export-surface diff gate for `@corestack/platform` (E05 readiness gate,
 * Section 4), mirroring kernel's `api-surface.test.ts` (E02-T13). Closes
 * the gap the E04 export-surface audit named: platform had zero
 * export-surface snapshot coverage for any of its 3 conditions.
 *
 * `./postgres` is safe to snapshot in the unit lane (no `test/integration`
 * exclusion needed): every file under `src/postgres/` and the
 * `src/infrastructure/postgres-*.ts` files it re-exports from use
 * `import type` only for the `postgres` package — the real driver is
 * injected by the caller as a constructor argument, never imported at
 * module scope. Confirmed empirically before writing this test (grepped
 * for a runtime `import ... from "postgres"` across every file this
 * barrel touches; found none).
 */
describe("platform public surface", () => {
  it("runtime exports are intentional (main entry)", () => {
    expect(Object.keys(platform).sort()).toMatchSnapshot();
  });

  it("runtime exports are intentional (./postgres subpath)", () => {
    expect(Object.keys(platformPostgres).sort()).toMatchSnapshot();
  });

  it("runtime exports are intentional (./testing subpath)", () => {
    expect(Object.keys(platformTesting).sort()).toMatchSnapshot();
  });
});
