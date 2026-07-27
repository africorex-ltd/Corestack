// AUD-08: the kernel's SENSITIVE_LOG_KEYS and the eslint sensitive-log rule
// both claim to be "the same deny-list, by convention". Convention drifts;
// this test makes the identity mechanical. Both sources are parsed textually
// (the lint config cannot import the kernel — it must work pre-build).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

function eslintDenyList() {
  const source = read("../index.mjs");
  const match = source.match(/Property\[key\.name=\/\^\(([^)]+)\)\$\/\]/);
  if (!match) throw new Error("sensitive-log selector not found in eslint config");
  return match[1].split("|").sort();
}

function kernelDenyList() {
  const source = read("../../../packages/kernel/src/logger.ts");
  const match = source.match(/SENSITIVE_LOG_KEYS:\s*readonly string\[\]\s*=\s*\[([\s\S]*?)\];/);
  if (!match) throw new Error("SENSITIVE_LOG_KEYS literal not found in kernel logger.ts");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

describe("sensitive-key deny-list synchronization (AUD-08)", () => {
  it("kernel SENSITIVE_LOG_KEYS and the eslint rule are set-identical", () => {
    expect(eslintDenyList()).toEqual(kernelDenyList());
  });
});
