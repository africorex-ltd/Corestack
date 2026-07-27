/**
 * The CoreStack error taxonomy.
 *
 * Every expected failure in the platform is an instance of `CoreError` with a
 * stable, machine-readable `code`. Interface layers map codes to transport
 * responses (HTTP status, problem+json, CLI exit codes) in one place; codes are
 * part of the public API and must never change once published.
 */

export type ErrorMetadata = Readonly<Record<string, unknown>>;

export interface CoreErrorOptions {
  readonly cause?: unknown;
  /** Structured, non-sensitive context safe to log and return to clients. */
  readonly metadata?: ErrorMetadata;
}

export abstract class CoreError extends Error {
  abstract readonly code: string;
  readonly metadata: ErrorMetadata;

  constructor(message: string, options: CoreErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.metadata = options.metadata ?? {};
  }
}

/** Input failed schema or semantic validation. */
export class ValidationError extends CoreError {
  readonly code = "core/validation";
}

/** The referenced resource does not exist (or is invisible to this caller). */
export class NotFoundError extends CoreError {
  readonly code = "core/not_found";
}

/** The operation conflicts with current state (duplicates, stale versions). */
export class ConflictError extends CoreError {
  readonly code = "core/conflict";
}

/** The caller is not authenticated. */
export class UnauthorizedError extends CoreError {
  readonly code = "core/unauthorized";
}

/** The caller is authenticated but not permitted to do this. */
export class ForbiddenError extends CoreError {
  readonly code = "core/forbidden";
}

export function isCoreError(value: unknown): value is CoreError {
  return value instanceof CoreError;
}
