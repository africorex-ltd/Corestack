/**
 * The ambient request/operation context.
 *
 * A `Context` is created once at an entry point (HTTP binding, job handler,
 * event consumer) and flows through every use case, event, and log line it
 * causes — it is the spine of the observability correlation model
 * (Architecture §32). Interface bindings resolve it from authenticated
 * state; it is never constructed from client-asserted input.
 */

import type { IdGenerator } from "./id.js";

export type ActorType = "user" | "api_key" | "system";

/** Who is performing the operation. `id` is null only for the system actor. */
export interface Actor {
  readonly type: ActorType;
  readonly id: string | null;
}

export interface Context {
  readonly actor: Actor;
  /** Resolved tenant scope; null for platform-scoped operations. */
  readonly organizationId: string | null;
  /** Identifies the whole causal journey (request → events → jobs → deliveries). */
  readonly correlationId: string;
  /** The id of the message (event/job) that directly caused this context, if any. */
  readonly causationId: string | null;
  /** BCP 47 tag for user-facing output; null = adopter default. */
  readonly locale: string | null;
}

export interface CreateContextInput {
  readonly actor: Actor;
  readonly organizationId?: string | null;
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly locale?: string | null;
}

export function createContext(input: CreateContextInput, ids: IdGenerator): Context {
  // Frozen (AUD-10): contexts are shared across use cases, events, and logs;
  // structural immutability must hold at runtime, not just in the types.
  return Object.freeze({
    actor: Object.freeze({ type: input.actor.type, id: input.actor.id }),
    organizationId: input.organizationId ?? null,
    correlationId: input.correlationId ?? ids.generate(),
    causationId: input.causationId ?? null,
    locale: input.locale ?? null,
  });
}

/** Context for platform-initiated work (sweepers, schedulers, migrations). */
export function systemContext(ids: IdGenerator): Context {
  return createContext({ actor: { type: "system", id: null } }, ids);
}

/**
 * Derive the context for work caused by a message (event or job): same
 * correlation journey, new causation link. Used by event consumers and job
 * handlers so "everything that happened because X" stays one query.
 */
export function causedBy(parent: Context, causationId: string): Context {
  return Object.freeze({ ...parent, causationId });
}
