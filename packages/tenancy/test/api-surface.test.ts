import { describe, expect, it } from "vitest";

import * as tenancy from "../src/index.js";
import * as tenancyTesting from "../src/testing/index.js";

/**
 * Export-surface snapshot test (E05-T01 Section 10, test 3 of 3) —
 * mirrors `packages/kernel/test/api-surface.test.ts` and
 * `packages/platform/test/api-surface.test.ts`: every runtime export is
 * intentional, one snapshot per declared `exports` condition. `./testing`
 * is intentionally empty right now (reserved for E05-T28) — the snapshot
 * records that as `[]`, not as an absent test.
 */
describe("tenancy public surface", () => {
  it("runtime exports are intentional (main entry)", () => {
    expect(Object.keys(tenancy).sort()).toMatchSnapshot();
  });

  it("runtime exports are intentional (./testing subpath)", () => {
    expect(Object.keys(tenancyTesting).sort()).toMatchSnapshot();
  });
});
