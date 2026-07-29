// Fitness: every class implementing a kernel port must appear in
// docs/testing/adapter-certification-matrix.md (E04 contract-suite
// governance, Section 13's "every exported adapter must appear in the
// certification matrix"). Text-based like every other rule in this
// package — matches `class X implements <PortName>` — so it is proven
// against both the real repository and synthetic fixtures before being
// trusted.
//
// The other two rules Section 13 requested ("no adapter may bypass its
// contract suite", "no duplicated behavioural test blocks once a shared
// suite exists") are NOT implemented here: both require semantic
// comparison of test-file contents against a suite's assertions — well
// beyond this package's deliberately lightweight regex/text scanning (see
// ADR-0021 for the identical triage applied to two of that certification's
// five requested rules). A rule that pattern-matches source text without
// understanding whether a test body actually duplicates a shared suite's
// assertions risks exactly the false-confidence failure mode ADR-0021
// warns against. Both stay reviewed-convention items: a reviewer checks,
// when a new adapter or test file is added, that it either uses the
// shared suite or has a stated reason not to (see
// docs/testing/contract-governance.md, "How to add a new contract suite").

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot, sourceFiles } from "./helpers.mjs";

const KERNEL_PORTS = [
  "Cache",
  "RateLimiter",
  "Logger",
  "EventBus",
  "UnitOfWork",
  "Encrypter",
  "ProcessedEventStore",
  "IdempotencyStore",
];

const IMPLEMENTS_PATTERN = new RegExp(
  `class\\s+(\\w+)\\s+implements\\s+(${KERNEL_PORTS.join("|")})\\b`,
  "g",
);

/** Every class in `files` that implements one of the kernel's ports. */
export function findPortAdapterClasses(files) {
  const found = [];
  for (const { path, content } of files) {
    for (const match of content.matchAll(IMPLEMENTS_PATTERN)) {
      found.push({ path, className: match[1], port: match[2] });
    }
  }
  return found;
}

/** Adapter class names absent from the certification matrix's text. */
export function checkAdaptersInMatrix(adapters, matrixContent) {
  return adapters
    .filter((adapter) => !matrixContent.includes(adapter.className))
    .map(
      (adapter) =>
        `${adapter.className} (implements ${adapter.port}, ${adapter.path}) is missing from the adapter certification matrix`,
    );
}

function readFiles(dir) {
  return sourceFiles(dir).map((path) => ({ path, content: readFileSync(path, "utf8") }));
}

describe("contract-suite adapter certification matrix", () => {
  it("every real kernel-port adapter (kernel + platform) appears in the certification matrix", () => {
    const files = [
      ...readFiles(join(repoRoot, "packages/kernel/src")),
      ...readFiles(join(repoRoot, "packages/platform/src")),
    ];
    const adapters = findPortAdapterClasses(files);

    // Sanity: the scan itself must find real adapters, or this test would
    // pass vacuously (zero adapters found -> zero violations -> "passes"
    // without checking anything).
    expect(adapters.length).toBeGreaterThan(0);

    const matrixContent = readFileSync(
      join(repoRoot, "docs/testing/adapter-certification-matrix.md"),
      "utf8",
    );
    expect(checkAdaptersInMatrix(adapters, matrixContent)).toEqual([]);
  });

  it("checkAdaptersInMatrix flags an adapter class the matrix text doesn't mention (synthetic violating fixture)", () => {
    const adapters = [{ path: "src/fake-adapter.ts", className: "TotallyUndocumentedAdapter", port: "Cache" }];
    const matrixContent = "# Adapter Certification Matrix\n\nNothing about that adapter here.";
    expect(checkAdaptersInMatrix(adapters, matrixContent)).toEqual([
      "TotallyUndocumentedAdapter (implements Cache, src/fake-adapter.ts) is missing from the adapter certification matrix",
    ]);
  });

  it("checkAdaptersInMatrix passes cleanly when every adapter is mentioned (synthetic passing fixture)", () => {
    const adapters = [{ path: "src/fake-adapter.ts", className: "DocumentedAdapter", port: "Cache" }];
    const matrixContent = "# Adapter Certification Matrix\n\n| Cache | `DocumentedAdapter` | ... |";
    expect(checkAdaptersInMatrix(adapters, matrixContent)).toEqual([]);
  });

  it("findPortAdapterClasses recognizes a class implementing a kernel port (synthetic fixture)", () => {
    const files = [
      {
        path: "src/fixture.ts",
        content: `export class FixtureRateLimiter implements RateLimiter {\n  async consume() {}\n}`,
      },
    ];
    expect(findPortAdapterClasses(files)).toEqual([
      { path: "src/fixture.ts", className: "FixtureRateLimiter", port: "RateLimiter" },
    ]);
  });

  it("findPortAdapterClasses ignores a class implementing an unrelated (non-kernel-port) interface", () => {
    const files = [
      {
        path: "src/fixture.ts",
        content: `export class FixtureRepository implements OrgScopedRepository {\n}`,
      },
    ];
    expect(findPortAdapterClasses(files)).toEqual([]);
  });
});
