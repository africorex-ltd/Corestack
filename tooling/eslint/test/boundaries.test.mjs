// Fixture tests for the layer-boundary and logging rules (blueprint E01-T02).
// Each fixture lints a *virtual* file at a layer-specific path through the
// real shared config — proving the zones fire (and don't overfire) forever,
// not just on the day someone manually probed them.

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ESLint } from "eslint";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

/** Lint source text as if it lived at repo-relative `virtualPath`; return rule IDs + messages. */
async function lintAt(virtualPath, code) {
  const [result] = await eslint.lintText(code, {
    filePath: join(repoRoot, virtualPath),
  });
  return result.messages.map((m) => ({ ruleId: m.ruleId, message: m.message }));
}

const ruleIds = (messages) => messages.map((m) => m.ruleId);

describe("layer boundaries", () => {
  it("domain may not import Node builtins", async () => {
    const messages = await lintAt(
      "packages/fixture/src/domain/entity.ts",
      'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n',
    );
    expect(ruleIds(messages)).toContain("no-restricted-imports");
    expect(messages.find((m) => m.ruleId === "no-restricted-imports")?.message).toMatch(
      /runtime-agnostic/,
    );
  });

  it("domain may not import outer layers", async () => {
    const messages = await lintAt(
      "packages/fixture/src/domain/entity.ts",
      'import { UseCase } from "../application/use-case.js";\nexport const x = UseCase;\n',
    );
    expect(ruleIds(messages)).toContain("no-restricted-imports");
  });

  it("application may not import infrastructure", async () => {
    const messages = await lintAt(
      "packages/fixture/src/application/use-case.ts",
      'import { Repo } from "../infrastructure/postgres/repo.js";\nexport const x = Repo;\n',
    );
    expect(ruleIds(messages)).toContain("no-restricted-imports");
  });

  it("the same boundary rule covers examples/*/src (golden-path modules are linted as strictly as shipped packages)", async () => {
    const messages = await lintAt(
      "examples/fixture-module/src/application/use-case.ts",
      'import { Repo } from "../infrastructure/postgres/repo.js";\nexport const x = Repo;\n',
    );
    expect(ruleIds(messages)).toContain("no-restricted-imports");
  });

  it("interface may not import infrastructure", async () => {
    const messages = await lintAt(
      "packages/fixture/src/interface/http/routes.ts",
      'import { Repo } from "../../infrastructure/postgres/repo.js";\nexport const x = Repo;\n',
    );
    expect(ruleIds(messages)).toContain("no-restricted-imports");
  });

  it("legal inward imports produce no boundary errors", async () => {
    const messages = await lintAt(
      "packages/fixture/src/application/use-case.ts",
      'import { Entity } from "../domain/entity.js";\nexport const x = Entity;\n',
    );
    expect(ruleIds(messages)).not.toContain("no-restricted-imports");
  });

  it("infrastructure may import inward freely", async () => {
    const messages = await lintAt(
      "packages/fixture/src/infrastructure/postgres/repo.ts",
      'import { Port } from "../../application/ports.js";\nexport const x = Port;\n',
    );
    expect(ruleIds(messages)).not.toContain("no-restricted-imports");
  });
});

describe("process global (E03-T22 exemption)", () => {
  it("is banned in ordinary infrastructure adapters", async () => {
    const messages = await lintAt(
      "packages/fixture/src/infrastructure/postgres/repo.ts",
      "export const url = process.env.DATABASE_URL;\n",
    );
    expect(ruleIds(messages)).toContain("no-restricted-globals");
  });

  it("is allowed only in the canonical *env-source.ts adapter", async () => {
    const messages = await lintAt(
      "packages/fixture/src/infrastructure/process-env-source.ts",
      "export const url = process.env.DATABASE_URL;\n",
    );
    expect(ruleIds(messages)).not.toContain("no-restricted-globals");
  });
});

describe("logging rules in production source", () => {
  it("console is banned in src", async () => {
    const messages = await lintAt(
      "packages/fixture/src/application/use-case.ts",
      'console.log("hello");\n',
    );
    expect(ruleIds(messages)).toContain("no-console");
  });

  it("console is allowed in tests and tooling", async () => {
    for (const path of ["packages/fixture/test/x.test.ts", "tooling/scripts/x.mjs"]) {
      const messages = await lintAt(path, 'console.log("hello");\n');
      expect(ruleIds(messages)).not.toContain("no-console");
    }
  });

  it("credential-bearing fields in logger metadata are banned", async () => {
    const messages = await lintAt(
      "packages/fixture/src/application/login.ts",
      'declare const logger: { error(msg: string, meta: object): void };\ndeclare const password: string;\nlogger.error("login failed", { password });\n',
    );
    expect(ruleIds(messages)).toContain("no-restricted-syntax");
    expect(messages.find((m) => m.ruleId === "no-restricted-syntax")?.message).toMatch(/redact/i);
  });

  it("safe logger metadata is not flagged", async () => {
    const messages = await lintAt(
      "packages/fixture/src/application/login.ts",
      'declare const logger: { error(msg: string, meta: object): void };\nlogger.error("login failed", { userId: "u1", attempt: 3 });\n',
    );
    expect(ruleIds(messages)).not.toContain("no-restricted-syntax");
  });

  it("sensitive names outside logger calls are not flagged (scoped heuristic)", async () => {
    const messages = await lintAt(
      "packages/fixture/src/domain/credentials.ts",
      "export const makeCredentials = (password: string) => ({ password });\n",
    );
    expect(ruleIds(messages)).not.toContain("no-restricted-syntax");
  });
});
