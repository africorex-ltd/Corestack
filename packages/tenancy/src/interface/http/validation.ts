import type { ZodType } from "zod";
import { ValidationError } from "@corestack/kernel";

/**
 * Same pattern as `domain/organization-id.ts`'s own `UUID_PATTERN` —
 * deliberately re-declared here, not imported from the domain layer.
 * This is a boundary check (Section 4), a different concern from the
 * domain's own construction-time invariant; duplicating one small, stable
 * regex is cheaper than coupling the interface layer to a domain
 * internal it doesn't otherwise need.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Same shape as `domain/email.ts`'s own `EMAIL_PATTERN` — re-declared for
 * the identical reason `UUID_PATTERN` is: a boundary check, not a
 * domain-internal import.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates a UUID-shaped string, throwing the kernel's `ValidationError`
 * (never a raw/uncaught mismatch) on failure — every route handler's
 * single `try`/`catch` (Section 14: no middleware) turns this into a 400
 * via `mapErrorToHttpResponse`. Used for path parameters (`organizationId`,
 * `invitationId`) and for header-sourced values that will otherwise reach
 * a raw `::uuid` cast in a repository's SQL (Section 6: a malformed value
 * reaching that cast unchecked would surface as a raw Postgres error, not
 * a clean 400 — this function exists specifically to make that
 * unreachable).
 */
export function parseUuid(value: string | undefined, fieldName: string): string {
  if (value === undefined || !UUID_PATTERN.test(value)) {
    throw new ValidationError(`${fieldName} must be a UUID`, {
      metadata: { field: fieldName, value },
    });
  }
  return value.toLowerCase();
}

/** Validates an email-shaped string — same normalization (trim, lowercase) `domain/email.ts`'s `Email.from` applies, checked again here as a boundary concern, not a domain re-implementation. */
export function parseEmail(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string`, {
      metadata: { field: fieldName },
    });
  }
  const normalized = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new ValidationError(`${fieldName} must be a valid email address`, {
      metadata: { field: fieldName, value },
    });
  }
  return normalized;
}

/** A required, non-empty header value — throws `ValidationError` if missing or blank. */
export function requireHeader(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = headers[name];
  if (value === undefined || value.trim().length === 0) {
    throw new ValidationError(`missing required header "${name}"`, {
      metadata: { header: name },
    });
  }
  return value.trim();
}

/**
 * Validates a request body against a Zod schema, bridging `ZodError` into
 * the kernel's `ValidationError` (ADR-0005: "validation failures surface
 * as the kernel's `ValidationError` with structured issue metadata; they
 * never throw raw Zod errors across layer boundaries"). Every route's
 * schema uses `.strict()` (unknown fields rejected) — the one piece of
 * API.md §19's "strict-in" request standard this task adopts, since it
 * costs nothing extra to add.
 */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError("request body failed validation", {
      metadata: {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }
  return result.data;
}
