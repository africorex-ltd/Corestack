/**
 * The domain event envelope (Architecture §13; ADR-0009).
 *
 * Events are versioned, JSON-serializable, immutable facts named in the past
 * tense (`tenancy.member.removed`). The envelope — not just the payload — is
 * the published contract: consumers rely on ids for idempotency, on
 * correlation/causation for tracing, and on `organizationId` for tenant
 * scoping. Renaming or reshaping a payload requires a new `version`.
 */

import type { Clock } from "./clock.js";
import type { Actor, Context } from "./context.js";
import { ValidationError } from "./errors.js";
import type { IdGenerator } from "./id.js";

export interface DomainEvent<TPayload = unknown> {
  readonly id: string;
  /** Dotted past-tense name: `<module>.<aggregate>.<happened>`. */
  readonly name: string;
  /** Contract version of the payload shape; bump on any incompatible change. */
  readonly version: number;
  readonly occurredAt: Date;
  /** Tenant scope; null for platform-scoped events. */
  readonly organizationId: string | null;
  readonly actor: Actor;
  readonly correlationId: string;
  readonly causationId: string | null;
  /** Must be JSON-serializable; enforced by convention and contract tests. */
  readonly payload: TPayload;
}

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export interface CreateEventInput<TPayload> {
  readonly name: string;
  readonly version: number;
  readonly payload: TPayload;
  /** Defaults to the context's organization; pass null to force platform scope. */
  readonly organizationId?: string | null;
}

export interface EventDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export function createEvent<TPayload>(
  input: CreateEventInput<TPayload>,
  context: Context,
  deps: EventDeps,
): DomainEvent<TPayload> {
  if (!EVENT_NAME_PATTERN.test(input.name)) {
    throw new ValidationError(`invalid event name "${input.name}"`, {
      metadata: { expected: "dotted lower_snake segments, e.g. tenancy.member.removed" },
    });
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new ValidationError(`invalid event version ${String(input.version)}`, {
      metadata: { name: input.name },
    });
  }
  // Frozen (AUD-10): events fan out to many consumers; a mutating consumer
  // must fail loudly, not corrupt later consumers. Note the envelope freeze
  // is shallow by design — `payload` immutability is the emitter's duty
  // (JSON-serializable value objects), and `occurredAt` is a Date whose
  // internals Object.freeze cannot protect; consumers must not call its
  // mutators (enforced by the readonly types and review).
  return Object.freeze({
    id: deps.ids.generate(),
    name: input.name,
    version: input.version,
    occurredAt: deps.clock.now(),
    organizationId:
      input.organizationId === undefined ? context.organizationId : input.organizationId,
    actor: context.actor,
    correlationId: context.correlationId,
    causationId: context.causationId,
    payload: input.payload,
  });
}

/** Wire shape: identical to `DomainEvent` with `occurredAt` as an ISO-8601 string. */
export interface SerializedDomainEvent<TPayload = unknown> extends Omit<
  DomainEvent<TPayload>,
  "occurredAt"
> {
  readonly occurredAt: string;
}

export function serializeEvent<TPayload>(
  event: DomainEvent<TPayload>,
): SerializedDomainEvent<TPayload> {
  return { ...event, occurredAt: event.occurredAt.toISOString() };
}

export function deserializeEvent<TPayload>(
  serialized: SerializedDomainEvent<TPayload>,
): DomainEvent<TPayload> {
  const occurredAt = new Date(serialized.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new ValidationError("invalid occurredAt timestamp in serialized event", {
      metadata: { eventId: serialized.id },
    });
  }
  return Object.freeze({ ...serialized, occurredAt });
}
