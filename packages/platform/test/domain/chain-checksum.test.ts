import { describe, expect, it } from "vitest";

import { computeAdvisoryLockKey, computeChainChecksum } from "../../src/domain/chain-checksum.js";

describe("computeChainChecksum", () => {
  it("is deterministic and order-sensitive", async () => {
    const a = await computeChainChecksum(["c1", "c2", "c3"]);
    const b = await computeChainChecksum(["c1", "c2", "c3"]);
    const reordered = await computeChainChecksum(["c3", "c2", "c1"]);
    expect(a).toBe(b);
    expect(a).not.toBe(reordered);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes if any single checksum in the chain changes (drift detection's foundation)", async () => {
    const original = await computeChainChecksum(["c1", "c2", "c3"]);
    const edited = await computeChainChecksum(["c1", "CHANGED", "c3"]);
    expect(original).not.toBe(edited);
  });

  it("the empty chain has a stable, well-defined checksum", async () => {
    const empty = await computeChainChecksum([]);
    expect(empty).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeAdvisoryLockKey", () => {
  it("is deterministic per module name", async () => {
    const a = await computeAdvisoryLockKey("tenancy");
    const b = await computeAdvisoryLockKey("tenancy");
    expect(a).toBe(b);
  });

  it("differs across module names", async () => {
    const tenancy = await computeAdvisoryLockKey("tenancy");
    const auth = await computeAdvisoryLockKey("auth");
    expect(tenancy).not.toBe(auth);
  });

  it("always fits Postgres's signed bigint range (non-negative, <= 2^63-1)", async () => {
    for (const name of ["tenancy", "auth", "rbac", "billing", "acme-crm"]) {
      const key = await computeAdvisoryLockKey(name);
      expect(key).toBeGreaterThanOrEqual(0n);
      expect(key).toBeLessThanOrEqual(0x7fffffffffffffffn);
    }
  });
});
