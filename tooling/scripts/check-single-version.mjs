// Single-version policy enforcement (blueprint E01-T01; structure doc §2).
// The toolchain must resolve to exactly one version spec across the workspace;
// per-package drift is how monorepos rot. Runs in CI; exits 1 on drift.
// Dependency-free by design: node tooling/scripts/check-single-version.mjs

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TOOLCHAIN = ["typescript", "vitest", "eslint", "prettier", "turbo"];
const WORKSPACE_GLOBS = ["packages", "apps", "tooling"];

const root = process.cwd();
const manifests = [join(root, "package.json")];
for (const dir of WORKSPACE_GLOBS) {
  const base = join(root, dir);
  if (!existsSync(base)) continue;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const manifest = join(base, entry.name, "package.json");
    if (entry.isDirectory() && existsSync(manifest)) manifests.push(manifest);
  }
}

/** @type {Map<string, Map<string, string[]>>} tool → spec → [manifest paths] */
const seen = new Map();
for (const path of manifests) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  // peerDependencies are excluded: peer ranges are deliberately loose — they
  // declare compatibility for consumers, not what this workspace installs.
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!TOOLCHAIN.includes(name)) continue;
      const bySpec = seen.get(name) ?? new Map();
      const users = bySpec.get(spec) ?? [];
      users.push(`${path.replace(root, ".")} (${field})`);
      bySpec.set(spec, users);
      seen.set(name, bySpec);
    }
  }
}

let failed = false;
for (const [tool, bySpec] of seen) {
  if (bySpec.size <= 1) continue;
  failed = true;
  console.error(`✖ ${tool} has ${bySpec.size} different version specs (single-version policy):`);
  for (const [spec, users] of bySpec) {
    for (const user of users) console.error(`    ${spec.padEnd(12)} ${user}`);
  }
}

if (failed) {
  console.error(
    "\nAlign the specs above to one version (see docs/engineering/10-repository-structure.md §2).",
  );
  process.exit(1);
}
console.log(`✓ single-version policy holds for: ${[...seen.keys()].join(", ") || "(none found)"}`);
