/**
 * Migration file format: parsing and identity (E03-T01).
 *
 * Normative source: DB design §18 ("every migration states its lock impact
 * in a header comment"; forward-only; expand-and-contract) and ADR-0015
 * (zero-downtime N/N+1 upgrades). This module is pure — no I/O, no Node
 * builtins (ADR-0001) — the loader (application layer) supplies raw file
 * content; here we only make sense of it.
 *
 * File naming: `NNNN_verb-noun.sql` per the repository naming convention
 * (docs/engineering/10-repository-structure.md §4) — the numeric prefix
 * *is* the migration's version, so ordering is visible in a file listing
 * without opening a single file.
 *
 * Header format: a contiguous run of leading `-- @key: value` lines. The
 * first line that does not match ends the header (whether blank or SQL) —
 * one rule, no special-casing of blank lines, fully predictable.
 *
 * Required header keys:
 *   @description  — one-line human summary
 *   @lock-impact  — none | brief | exclusive (DB §18's mandated lock note)
 * Optional:
 *   @concurrent   — "true" | "false" (informational: uses CREATE INDEX
 *                   CONCURRENTLY or similar; guides the runner's future
 *                   transaction-wrapping decision, T02)
 */

import { ValidationError } from "@corestack/kernel";

export type LockImpact = "none" | "brief" | "exclusive";

export interface MigrationHeader {
  readonly description: string;
  readonly lockImpact: LockImpact;
  readonly concurrent: boolean;
}

export interface MigrationFile {
  readonly module: string;
  readonly filename: string;
  /** Parsed from the filename's numeric prefix; the module's ordering key. */
  readonly version: number;
  readonly header: MigrationHeader;
  /** The SQL body, header stripped, trimmed. */
  readonly sql: string;
  /** SHA-256 hex digest of the *entire* raw file (header + body) — any edit changes it. */
  readonly checksum: string;
}

const FILENAME_PATTERN = /^(\d{4})_([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.sql$/;
const HEADER_LINE_PATTERN = /^--\s*@([a-z][a-z0-9-]*):\s*(.*)$/;
const REQUIRED_HEADER_KEYS = ["description", "lock-impact"] as const;
const LOCK_IMPACT_VALUES: readonly LockImpact[] = ["none", "brief", "exclusive"];
// Same shape as the filename slug: lowercase, hyphen-separated segments.
// Hyphens must be allowed — third-party modules are named like "acme-crm"
// (Architecture §24's `/x/{moduleKey}` convention), not just single words.
const MODULE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Guards every filesystem access that takes a module name as input
 * (security §7: this is the load-bearing defense against a module name
 * ever being used to traverse outside its configured directory). A bad
 * module name is a static, call-site programming error — not a runtime
 * data-quality issue — so this throws rather than returning a `Result`.
 */
export function assertValidModuleName(moduleName: string): void {
  if (!MODULE_NAME_PATTERN.test(moduleName)) {
    throw new ValidationError(
      `invalid module name "${moduleName}" (expected a lowercase, hyphen-separated identifier)`,
      { metadata: { moduleName } },
    );
  }
}

export function parseMigrationVersion(filename: string): number {
  const match = FILENAME_PATTERN.exec(filename);
  if (!match) {
    throw new ValidationError(
      `migration filename does not match NNNN_verb-noun.sql: "${filename}"`,
      { metadata: { filename } },
    );
  }
  return parseInt(match[1] as string, 10);
}

export function parseMigrationHeader(
  filename: string,
  source: string,
): { header: MigrationHeader; sql: string } {
  const lines = source.split(/\r?\n/);
  const found = new Map<string, string>();
  let bodyStartIndex = 0;

  for (const line of lines) {
    const match = HEADER_LINE_PATTERN.exec(line);
    if (!match) break;
    const key = match[1] as string;
    const value = (match[2] as string).trim();
    if (found.has(key)) {
      throw new ValidationError(`duplicate header key "@${key}" in migration "${filename}"`, {
        metadata: { filename, key },
      });
    }
    found.set(key, value);
    bodyStartIndex += 1;
  }

  for (const key of REQUIRED_HEADER_KEYS) {
    if (!found.has(key)) {
      throw new ValidationError(`migration "${filename}" is missing required header "@${key}"`, {
        metadata: { filename, missingKey: key },
      });
    }
  }

  const lockImpact = found.get("lock-impact") as string;
  if (!LOCK_IMPACT_VALUES.includes(lockImpact as LockImpact)) {
    throw new ValidationError(
      `migration "${filename}" has invalid @lock-impact "${lockImpact}" (expected one of: ${LOCK_IMPACT_VALUES.join(", ")})`,
      { metadata: { filename, lockImpact } },
    );
  }

  const concurrentRaw = found.get("concurrent");
  if (concurrentRaw !== undefined && concurrentRaw !== "true" && concurrentRaw !== "false") {
    throw new ValidationError(
      `migration "${filename}" has invalid @concurrent "${concurrentRaw}" (expected "true" or "false")`,
      { metadata: { filename, concurrent: concurrentRaw } },
    );
  }

  const sql = lines.slice(bodyStartIndex).join("\n").trim();
  if (sql.length === 0) {
    throw new ValidationError(`migration "${filename}" has no SQL body after its header`, {
      metadata: { filename },
    });
  }

  return {
    header: {
      description: found.get("description") as string,
      lockImpact: lockImpact as LockImpact,
      concurrent: concurrentRaw === "true",
    },
    sql,
  };
}

/** SHA-256 hex digest of the raw file content — deterministic, pure. */
export async function computeChecksum(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Parse one migration file's raw content into its full, checked identity. */
export async function parseMigrationFile(
  moduleName: string,
  filename: string,
  source: string,
): Promise<MigrationFile> {
  assertValidModuleName(moduleName);
  const version = parseMigrationVersion(filename);
  const { header, sql } = parseMigrationHeader(filename, source);
  const checksum = await computeChecksum(source);
  return { module: moduleName, filename, version, header, sql, checksum };
}
