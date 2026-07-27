export type { Ok, Err, Result } from "./result.js";
export { ok, err, isOk, isErr, map, mapErr, andThen, unwrapOr, unwrapOrThrow } from "./result.js";

export type { ErrorMetadata, CoreErrorOptions } from "./errors.js";
export {
  CoreError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  isCoreError,
} from "./errors.js";

export type { Clock } from "./clock.js";
export { SystemClock, FixedClock } from "./clock.js";

export type { IdGenerator } from "./id.js";
export { UuidGenerator, SequentialIdGenerator } from "./id.js";
