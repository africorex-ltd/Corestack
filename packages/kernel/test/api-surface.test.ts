import { describe, expect, it } from "vitest";

import * as kernel from "../src/index.js";

/**
 * The export-surface diff gate (E02-T13): changing the kernel's runtime
 * public surface changes this snapshot, forcing an explicit, reviewable
 * decision in the PR. Type-only exports are not visible here; the full
 * type-level API report arrives with the pre-1.0 freeze tooling (E19-T14).
 */
describe("kernel public surface", () => {
  it("runtime exports are intentional", () => {
    expect(Object.keys(kernel).sort()).toMatchSnapshot();
  });
});
