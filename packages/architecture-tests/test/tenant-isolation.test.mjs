// Fitness: tenant-isolation rules (ADR-0021, Tenant Isolation Certification
// §5). Rule-checking logic is factored into pure functions taking
// { path, content } tuples — not tied to reading real files — so each rule
// is proven against both the real repository *and* a synthetic violating
// fixture before being trusted, per the certification's own requirement
// that "every test must fail against an intentionally unsafe
// implementation." Two requested rules (event-consumer naming, purge
// handler organizationId extraction) are deliberately NOT implemented here
// — see ADR-0021 for why a text-pattern rule would give false confidence
// for those two, and where each is enforced instead.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { display, sourceFiles, workspacePackages } from "./helpers.mjs";

const PLATFORM_TABLE_PATTERN =
  /platform\.(outbox_checkpoints|outbox|rate_limits|idempotency_keys|module_migrations|processed_events)\b/;
const ADR_PATTERN = /ADR-\d{4}/;
const APPROVED_TABLE_ACCESS_DIRS = ["/infrastructure/", "/test/", "/test-support/"];

/**
 * Rule: any `*repository*.ts` file must reference either `OrgScopedContext`
 * (proving at least one org-scoped touchpoint) or `GlobalRepository` (an
 * explicit, ADR-cited opt-out). A file referencing `GlobalRepository`
 * without an `ADR-####` citation in the same file also fails.
 */
export function checkRepositoryOrgScoping(files) {
  const violations = [];
  for (const { path, content } of files) {
    if (!/repository/i.test(path)) continue;

    const hasOrgScoped = /OrgScopedContext/.test(content);
    const hasGlobalMarker = /GlobalRepository/.test(content);

    if (!hasOrgScoped && !hasGlobalMarker) {
      violations.push(
        `${path}: repository file references neither OrgScopedContext nor GlobalRepository`,
      );
    }
    if (hasGlobalMarker && !ADR_PATTERN.test(content)) {
      violations.push(`${path}: implements GlobalRepository without an ADR-#### reference`);
    }
  }
  return violations;
}

/** Strips comments so TSDoc prose mentioning a table name (documentation,
 * not execution) doesn't false-positive the platform-table-access rule. */
function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// Matches a `sql` tagged template (`` sql`...` ``) or a `.unsafe(`...`)` call
// — the two forms every real query in this codebase uses (postgres.js).
// A bare template literal that happens to embed the text "platform.foo" for
// some other purpose (e.g. hashing a table name into an advisory-lock key,
// which touches no database at all) is not a SQL-execution context and must
// not be flagged.
const SQL_CONTEXT_PATTERN = /(?:\bsql\s*`([^`]*)`)|(?:\.unsafe\(\s*`([^`]*)`)/g;

function sqlContexts(content) {
  const contexts = [];
  for (const match of content.matchAll(SQL_CONTEXT_PATTERN)) {
    contexts.push(match[1] ?? match[2] ?? "");
  }
  return contexts;
}

/**
 * Rule: no source file outside an approved adapter directory may execute a
 * SQL statement (a `sql` tagged template or `.unsafe(...)` call) referencing
 * a `platform.<table>` schema-qualified name directly. Mentioning the table
 * name in a comment, or embedding it in a non-SQL string (e.g. as
 * advisory-lock-key hash input), is not a violation — only real query
 * execution is in scope.
 */
export function checkPlatformTableAccess(files, allowedDirs = APPROVED_TABLE_ACCESS_DIRS) {
  const violations = [];
  for (const { path, content } of files) {
    if (allowedDirs.some((dir) => path.includes(dir))) continue;
    const contexts = sqlContexts(stripComments(content));
    if (contexts.some((ctx) => PLATFORM_TABLE_PATTERN.test(ctx))) {
      violations.push(`${path}: references a platform.* table outside an approved adapter`);
    }
  }
  return violations;
}

function realRepoFiles() {
  const files = [];
  for (const pkg of workspacePackages()) {
    for (const file of sourceFiles(join(pkg.dir, "src"))) {
      files.push({ path: display(file), content: readFileSync(file, "utf8") });
    }
  }
  return files;
}

describe("tenant-isolation architecture fitness (ADR-0021)", () => {
  describe("rule: repository org-scoping", () => {
    it("real repo: every repository file is org-scoped or an explicitly ADR'd GlobalRepository", () => {
      const violations = checkRepositoryOrgScoping(realRepoFiles());
      expect(violations, violations.join("\n")).toEqual([]);
    });

    it("SECURITY: fires on a repository file with no org-scoping and no GlobalRepository marker", () => {
      const violations = checkRepositoryOrgScoping([
        {
          path: "packages/fixture/src/infrastructure/postgres-evil-repository.ts",
          content: `
            export class EvilRepository {
              async listAll() {
                return sql\`SELECT * FROM widgets\`;
              }
            }
          `,
        },
      ]);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("SECURITY: fires on a repository implementing GlobalRepository without an ADR citation", () => {
      const violations = checkRepositoryOrgScoping([
        {
          path: "packages/fixture/src/infrastructure/postgres-admin-repository.ts",
          content: `
            import type { GlobalRepository } from "@corestack/platform";
            export class AdminRepository implements GlobalRepository {
              readonly __globalRepository = true as const;
            }
          `,
        },
      ]);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("passes a repository file that references OrgScopedContext", () => {
      const violations = checkRepositoryOrgScoping([
        {
          path: "packages/fixture/src/infrastructure/postgres-widget-repository.ts",
          content: `
            import type { OrgScopedContext } from "@corestack/platform";
            export class WidgetRepository {
              async list(context: OrgScopedContext) { }
            }
          `,
        },
      ]);
      expect(violations).toEqual([]);
    });

    it("passes a repository file that implements GlobalRepository with an ADR citation", () => {
      const violations = checkRepositoryOrgScoping([
        {
          path: "packages/fixture/src/infrastructure/postgres-admin-repository.ts",
          content: `
            // ADR-0021: platform-wide admin repository, cross-tenant by design.
            import type { GlobalRepository } from "@corestack/platform";
            export class AdminRepository implements GlobalRepository {
              readonly __globalRepository = true as const;
            }
          `,
        },
      ]);
      expect(violations).toEqual([]);
    });
  });

  describe("rule: platform table access confined to approved adapters", () => {
    it("real repo: no SQL helper accesses a platform.* table outside infrastructure/test", () => {
      const violations = checkPlatformTableAccess(realRepoFiles());
      expect(violations, violations.join("\n")).toEqual([]);
    });

    it("SECURITY: fires on a non-adapter file referencing platform.outbox directly", () => {
      const violations = checkPlatformTableAccess([
        {
          path: "packages/fixture/src/application/sneaky-use-case.ts",
          content: "await sql`SELECT * FROM platform.outbox`;",
        },
      ]);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("passes the identical reference when it lives in an infrastructure/ adapter file", () => {
      const violations = checkPlatformTableAccess([
        {
          path: "packages/fixture/src/infrastructure/postgres-outbox-writer.ts",
          content: "await sql`SELECT * FROM platform.outbox`;",
        },
      ]);
      expect(violations).toEqual([]);
    });
  });
});
