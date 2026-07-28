/**
 * Safe SQL identifier validation (E03-T10). Postgres role/identifier names
 * cannot be passed as query parameters (placeholders bind *values*, not
 * identifiers) — any identifier interpolated into DDL text must be
 * validated against a closed character set first, the same structural
 * defense `assertValidModuleName` (T01) applies to module names.
 */

import { ValidationError } from "@corestack/kernel";

const SQL_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

export function assertSafeSqlIdentifier(identifier: string, purpose: string): void {
  if (!SQL_IDENTIFIER_PATTERN.test(identifier)) {
    throw new ValidationError(
      `invalid ${purpose} "${identifier}" (expected a lowercase SQL identifier: letters, digits, underscore, not starting with a digit)`,
      { metadata: { identifier, purpose } },
    );
  }
}
