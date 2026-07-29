// Shared helpers for the fitness suite: repo walking and import extraction.
// Zero dependencies by policy — a custom 40-line walker beats a dependency
// in the package whose job is guarding dependencies.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** All package dirs (with package.json) under packages/, apps/, tooling/. */
export function workspacePackages() {
  const found = [];
  for (const group of ["packages", "apps", "tooling", "examples"]) {
    const base = join(repoRoot, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const dir = join(base, entry.name);
      if (entry.isDirectory() && existsSync(join(dir, "package.json"))) {
        found.push({
          dir,
          group,
          manifest: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")),
        });
      }
    }
  }
  return found;
}

/** Recursively list source files under dir (ts/mts/mjs/js), skipping dist. */
export function sourceFiles(dir, exts = [".ts", ".mts", ".mjs", ".js"]) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      files.push(...sourceFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;

/** Static import/re-export specifiers of a file. */
export function importsOf(file) {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(IMPORT_PATTERN)].map((m) => m[1]);
}

/** Resolve a relative specifier against its file; returns absolute path (extension-less). */
export function resolveRelative(file, specifier) {
  return resolve(dirname(file), specifier).replace(/\.(js|mjs|ts|mts)$/, "");
}

/** repo-relative display path */
export function display(file) {
  return relative(repoRoot, file).split(sep).join("/");
}
