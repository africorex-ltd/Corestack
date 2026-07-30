/**
 * Postgres unique-constraint-violation detection (E05-T11 Section 8) —
 * translates a caught `postgres.js` error into a `(code, constraintName)`
 * pair a repository's `save()` can switch on to produce the right domain
 * error (`DuplicateSlugError`/`MembershipAlreadyExistsError`/
 * `InvitationAlreadyExistsError`), instead of leaking a raw Postgres
 * error out of the repository.
 *
 * SQLSTATE `23505` (`unique_violation`) and the `constraint_name` field
 * were confirmed empirically against a real PostgreSQL 18.4 instance
 * before writing this — not guessed: `postgres.js` surfaces both as
 * plain string properties on the thrown error object (`error.code`,
 * `error.constraint_name`), alongside `table_name`/`schema_name`/`detail`.
 *
 * **Known remaining leak point (Section 8: "document any remaining leak
 * points")**: every other Postgres error — connection failures, FK
 * violations (`23503`), check-constraint violations (`23514`), syntax
 * errors, RLS `current_setting` failures (`42704`), permission errors
 * (`42501`) — is deliberately **not** caught here and propagates as a raw
 * `postgres.js` error out of every repository method. Only the specific,
 * expected-at-the-application-layer unique-violation case is translated;
 * anything else is a genuine, unexpected failure a caller should not
 * silently swallow.
 */
const PG_UNIQUE_VIOLATION = "23505";

interface PostgresErrorShape {
  readonly code?: unknown;
  readonly constraint_name?: unknown;
}

function asPostgresError(error: unknown): PostgresErrorShape | undefined {
  return typeof error === "object" && error !== null ? (error as PostgresErrorShape) : undefined;
}

/** Whether `error` is a Postgres unique-violation (SQLSTATE `23505`). */
export function isUniqueViolation(error: unknown): boolean {
  return asPostgresError(error)?.code === PG_UNIQUE_VIOLATION;
}

/**
 * The violated constraint's name, if `error` is a unique violation and
 * Postgres reported one — `undefined` for any other error, or a unique
 * violation that (unusually) carries no `constraint_name`.
 */
export function uniqueViolationConstraintName(error: unknown): string | undefined {
  if (!isUniqueViolation(error)) return undefined;
  const constraintName = asPostgresError(error)?.constraint_name;
  return typeof constraintName === "string" ? constraintName : undefined;
}
