/**
 * Pure domain logic for a CRM contact — no I/O, no Node builtins, no
 * kernel/platform imports (Clean Architecture's innermost layer).
 */

export interface Contact {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly email: string;
  readonly createdAt: Date;
}

export interface CreateContactInput {
  readonly name: string;
  readonly email: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ContactValidationIssue {
  readonly field: "name" | "email";
  readonly message: string;
}

/** Aggregated, not fail-fast — matching this platform's config/migration validation convention. */
export function validateCreateContactInput(
  input: CreateContactInput,
): readonly ContactValidationIssue[] {
  const issues: ContactValidationIssue[] = [];
  if (input.name.trim().length === 0) {
    issues.push({ field: "name", message: "name must not be empty" });
  }
  if (!EMAIL_PATTERN.test(input.email)) {
    issues.push({ field: "email", message: "email is not a valid address" });
  }
  return issues;
}
