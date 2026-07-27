// Fitness: manifest/ADR compliance where mechanically checkable.
// ADR-0001 (ESM-only), ADR-0006 (MIT), publish hygiene (AUD-06), and the
// kernel's zero-runtime-dependency guarantee.

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { workspacePackages } from "./helpers.mjs";

const packages = workspacePackages();
const publishable = packages.filter((p) => p.group === "packages" && p.manifest.private !== true);

describe("manifest rules", () => {
  it("every workspace package is ESM (ADR-0001)", () => {
    const offenders = packages
      .filter(
        (p) =>
          p.manifest.type !== "module" &&
          p.manifest.name !== "@corestack/tsconfig" &&
          p.manifest.name !== "@corestack/prettier-config",
      )
      .map((p) => p.manifest.name);
    expect(offenders).toEqual([]);
  });

  for (const pkg of publishable) {
    describe(pkg.manifest.name, () => {
      it("declares MIT license, engines floor, repository, and exports map", () => {
        expect(pkg.manifest.license).toBe("MIT");
        expect(pkg.manifest.engines?.node).toBe(">=20.11");
        expect(pkg.manifest.repository?.url).toContain("africorex-ltd/Corestack");
        expect(pkg.manifest.exports).toBeDefined();
        expect(pkg.manifest.sideEffects).toBe(false);
      });

      it("ships a LICENSE file in the tarball", () => {
        expect(existsSync(join(pkg.dir, "LICENSE"))).toBe(true);
        expect(pkg.manifest.files).toContain("LICENSE");
      });

      it("exposes types-first export conditions", () => {
        for (const entry of Object.values(pkg.manifest.exports)) {
          if (typeof entry === "object" && entry !== null) {
            expect(Object.keys(entry)[0]).toBe("types");
          }
        }
      });
    });
  }

  it("the kernel has ZERO runtime dependencies (kernel charter)", () => {
    const kernel = packages.find((p) => p.manifest.name === "@corestack/kernel");
    expect(kernel).toBeDefined();
    expect(kernel.manifest.dependencies).toBeUndefined();
    expect(kernel.manifest.peerDependencies).toBeUndefined();
  });

  it("private packages are never publishable by accident", () => {
    for (const pkg of packages.filter((p) => p.group !== "packages" || p.manifest.private)) {
      expect(pkg.manifest.private, `${pkg.manifest.name ?? pkg.dir} must stay private`).toBe(true);
    }
  });
});
