// Fitness: no circular imports within any package's src/ (governance §7.1).
// Cycles are how "modular" degrades into "tangled" one convenient import at
// a time; this fails the build at cycle #1.

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { workspacePackages, sourceFiles, importsOf, resolveRelative, display } from "./helpers.mjs";

function findCycle(graph) {
  const visiting = new Set();
  const done = new Set();
  const stack = [];

  function visit(node) {
    if (done.has(node)) return null;
    if (visiting.has(node)) {
      return [...stack.slice(stack.indexOf(node)), node];
    }
    visiting.add(node);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      if (!graph.has(dep)) continue; // external / non-source
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    done.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

describe("no import cycles inside package sources", () => {
  for (const pkg of workspacePackages()) {
    const src = join(pkg.dir, "src");
    const files = sourceFiles(src);
    if (files.length === 0) continue;

    it(`${pkg.manifest.name} src/ is acyclic`, () => {
      const graph = new Map();
      for (const file of files) {
        const key = file.replace(/\.(ts|mts|mjs|js)$/, "");
        const deps = importsOf(file)
          .filter((s) => s.startsWith("."))
          .map((s) => resolveRelative(file, s));
        graph.set(key, deps);
      }
      const cycle = findCycle(graph);
      expect(
        cycle === null ? null : cycle.map(display).join(" → "),
        "import cycle detected",
      ).toBeNull();
    });
  }
});
