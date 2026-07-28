// Fitness: cross-package boundaries (AUD-12; Architecture §47; ADR-0016).
// - No deep imports into another package's dist/ or src/ via specifier.
// - No relative imports escaping a package's own directory.
// - Runtime cross-module imports between @corestack modules are forbidden
//   except the two shared bases (kernel, platform) and a module's own
//   subpaths; the sanctioned exception is `/contracts` subpaths (types
//   only) — enforced structurally here, types-only-ness enforced at review
//   + lint (E01-T02.4 hardens further).

import { describe, expect, it } from "vitest";
import { join, relative, isAbsolute } from "node:path";
import { workspacePackages, sourceFiles, importsOf, resolveRelative, display } from "./helpers.mjs";

const packages = workspacePackages();
const moduleNames = new Set(
  packages.map((p) => p.manifest.name).filter((n) => n?.startsWith("@corestack/")),
);

describe("cross-package import boundaries", () => {
  for (const pkg of packages) {
    const files = [...sourceFiles(join(pkg.dir, "src")), ...sourceFiles(join(pkg.dir, "test"))];
    if (files.length === 0) continue;

    it(`${pkg.manifest.name ?? pkg.dir} has no boundary-violating imports`, () => {
      const violations = [];
      for (const file of files) {
        for (const spec of importsOf(file)) {
          // 1. Deep reach into another package's internals by specifier.
          if (/^@corestack\/[^/]+\/(dist|src)\b/.test(spec)) {
            violations.push(`${display(file)} imports package internals: "${spec}"`);
          }
          // 2. Relative escape out of the package directory.
          if (spec.startsWith(".")) {
            const resolved = resolveRelative(file, spec);
            const rel = relative(pkg.dir, resolved);
            if (rel.startsWith("..") || isAbsolute(rel)) {
              // Sanctioned: fitness/tooling tests may read sibling sources
              // read-only via fs, but must not IMPORT them. The only import
              // exemption is within tooling/* test files reaching tooling
              // fixtures — none exist yet, so no exemptions are coded.
              violations.push(`${display(file)} escapes its package: "${spec}"`);
            }
          }
        }
      }
      expect(violations, violations.join("\n")).toEqual([]);
    });
  }

  it("runtime dependencies between @corestack packages point only at the shared bases (Architecture §47; ADR-0016)", () => {
    // Two shared bases: kernel (zero-dep, runtime-agnostic) and platform
    // (I/O-capable composition/migration/outbox tooling — depends only on
    // kernel itself). Every other module may depend on either or both, but
    // never on another module, and platform may never depend downward on
    // a module.
    const SHARED_BASES = new Set(["@corestack/kernel", "@corestack/platform"]);
    const offenders = [];
    for (const pkg of packages) {
      const deps = Object.keys(pkg.manifest.dependencies ?? {});
      for (const dep of deps) {
        if (!dep.startsWith("@corestack/") || !moduleNames.has(dep) || dep === pkg.manifest.name)
          continue;
        const allowed =
          pkg.manifest.name === "@corestack/platform"
            ? dep === "@corestack/kernel"
            : SHARED_BASES.has(dep);
        if (!allowed) offenders.push(`${pkg.manifest.name} → ${dep}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
