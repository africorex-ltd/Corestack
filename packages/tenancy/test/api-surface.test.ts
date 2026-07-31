import { describe, expect, it } from "vitest";

import * as tenancy from "../src/index.js";
import * as tenancyPostgres from "../src/postgres/index.js";
import * as tenancyTesting from "../src/testing/index.js";
import * as tenancyInterface from "../src/interface/index.js";

/**
 * Export-surface snapshot test (E05-T01 Section 10, test 3 of 3) —
 * mirrors `packages/kernel/test/api-surface.test.ts` and
 * `packages/platform/test/api-surface.test.ts`: every runtime export is
 * intentional, one snapshot per declared `exports` condition. `./testing`
 * is intentionally empty right now (reserved for E05-T28) — the snapshot
 * records that as `[]`, not as an absent test. `./postgres` added in
 * E05-T11 alongside the real Postgres repository adapters. `./interface`
 * added in E05-T13 alongside the HTTP interface layer.
 */
describe("tenancy public surface", () => {
  it("runtime exports are intentional (main entry)", () => {
    expect(Object.keys(tenancy).sort()).toMatchSnapshot();
  });

  it("runtime exports are intentional (./postgres subpath)", () => {
    expect(Object.keys(tenancyPostgres).sort()).toMatchSnapshot();
  });

  it("runtime exports are intentional (./testing subpath)", () => {
    expect(Object.keys(tenancyTesting).sort()).toMatchSnapshot();
  });

  it("runtime exports are intentional (./interface subpath)", () => {
    expect(Object.keys(tenancyInterface).sort()).toMatchSnapshot();
  });
});
