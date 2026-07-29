import { describe, expect, it } from "vitest";

import * as kernel from "../src/index.js";
import * as kernelTesting from "../src/testing/index.js";

/**
 * The export-surface diff gate (E02-T13): changing the kernel's runtime
 * public surface changes this snapshot, forcing an explicit, reviewable
 * decision in the PR. Type-only exports are not visible here; the full
 * type-level API report arrives with the pre-1.0 freeze tooling (E19-T14).
 *
 * `./testing` (E05 readiness gate, Section 4) closes the gap the E04
 * export-surface audit named: the contract-suite factories are genuine
 * public API (see contract-governance.md's "How to add a new contract
 * suite") and were previously ungated against an accidental rename or
 * removal.
 */
describe("kernel public surface", () => {
  it("runtime exports are intentional (main entry)", () => {
    expect(Object.keys(kernel).sort()).toMatchSnapshot();
  });

  it("runtime exports are intentional (./testing subpath)", () => {
    expect(Object.keys(kernelTesting).sort()).toMatchSnapshot();
  });
});
