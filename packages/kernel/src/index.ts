export type { Ok, Err, Result } from "./result.js";
export {
  ok,
  err,
  isOk,
  isErr,
  map,
  mapErr,
  andThen,
  unwrapOr,
  unwrapOrThrow,
  all,
  fromPromise,
  mapAsync,
  andThenAsync,
} from "./result.js";

export type { ErrorMetadata, CoreErrorOptions } from "./errors.js";
export {
  CoreError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitedError,
  PayloadTooLargeError,
  PreconditionFailedError,
  CryptoFailureError,
  isCoreError,
} from "./errors.js";

export type { Clock } from "./clock.js";
export { SystemClock, FixedClock } from "./clock.js";

export type { IdGenerator } from "./id.js";
export { UuidGenerator, SequentialIdGenerator } from "./id.js";

export type { ActorType, Actor, Context, CreateContextInput } from "./context.js";
export { createContext, systemContext, causedBy } from "./context.js";

export type { DomainEvent, CreateEventInput, EventDeps, SerializedDomainEvent } from "./event.js";
export { createEvent, serializeEvent, deserializeEvent } from "./event.js";

export type { EventHandler, EventSubscription, Unsubscribe, EventBus } from "./event-bus.js";
export { InMemoryEventBus } from "./event-bus.js";

export type { LogLevel, LogFields, Logger, CapturedLogEntry } from "./logger.js";
export { SENSITIVE_LOG_KEYS, NoopLogger, CaptureLogger } from "./logger.js";

export type { Cache } from "./cache.js";
export { versionedKey, InMemoryLruCache } from "./cache.js";

export type { RateLimitPolicy, RateLimitDecision, RateLimiter } from "./rate-limiter.js";
export { InMemoryRateLimiter } from "./rate-limiter.js";

export type { EncryptedValue, Encrypter } from "./encrypter.js";
export { WebCryptoAesGcmEncrypter } from "./encrypter.js";

export type { TransactionContext, UnitOfWork, InMemoryUnitOfWorkOptions } from "./unit-of-work.js";
export { InMemoryUnitOfWork } from "./unit-of-work.js";

export type { ProcessedEventStore } from "./processed-events.js";
export { InMemoryProcessedEventStore, idempotentHandler } from "./processed-events.js";

export type { IdempotencyBeginResult, IdempotencyStore } from "./idempotency-store.js";
export { InMemoryIdempotencyStore } from "./idempotency-store.js";
