/**
 * Explicit, typed handling of expected failures.
 *
 * CoreStack convention (see docs/architecture/overview.md): use cases return
 * `Result` for failures a caller is expected to handle (validation, not-found,
 * conflicts); genuinely unexpected failures throw.
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Transform the success value, passing errors through unchanged. */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Transform the error, passing success values through unchanged. */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Chain a fallible operation onto a success value (flatMap). */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/** Extract the success value or fall back to a default. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Extract the success value or throw the error.
 *
 * Only for boundaries where an `Err` is a programming bug (e.g. tests, or code
 * paths that have already checked `isOk`). Never use it to skip error handling
 * in application code.
 */
export function unwrapOrThrow<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  if (result.error instanceof Error) {
    throw result.error;
  }
  throw new TypeError(`Called unwrapOrThrow on an Err result: ${String(result.error)}`);
}

/** Combine results: all Ok → Ok of values (in order); else the first Err. */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Bridge a throwing boundary into Result space. `mapError` is mandatory:
 * an untyped `unknown` error escaping into use-case signatures is exactly
 * what the Result convention exists to prevent.
 */
export async function fromPromise<T, E>(
  promise: Promise<T>,
  mapError: (error: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await promise);
  } catch (error) {
    return err(mapError(error));
  }
}

/** Async variant of `map`. */
export async function mapAsync<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Promise<U>,
): Promise<Result<U, E>> {
  return result.ok ? ok(await fn(result.value)) : result;
}

/** Async variant of `andThen`. */
export async function andThenAsync<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Promise<Result<U, E>>,
): Promise<Result<U, E>> {
  return result.ok ? fn(result.value) : result;
}
