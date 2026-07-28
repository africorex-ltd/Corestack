/**
 * Maps a kernel `DomainEvent` (ADR-0009) to the exact `platform.outbox`
 * row shape (E03-T10; DB design §3). Pure — no I/O — so the mapping is
 * testable without Postgres and reusable by any adapter, not just the
 * Postgres one this task ships.
 */
import type { DomainEvent } from "@corestack/kernel";

export interface OutboxEventRow {
  readonly id: string;
  readonly event_name: string;
  readonly event_version: number;
  readonly occurred_at: string;
  readonly organization_id: string | null;
  readonly actor_type: string;
  readonly actor_id: string | null;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  /**
   * Left as the raw JSON-serializable value, not pre-stringified: verified
   * against real Postgres that `postgres.js` only round-trips a `jsonb`
   * column back into a JS object on `SELECT` when the driver itself
   * serializes the value — a pre-stringified payload inserts fine (the
   * column stores valid JSON either way) but comes back as a plain string,
   * not the original object, breaking every consumer that expects
   * `event.payload` shape on replay.
   */
  readonly payload: unknown;
}

export function toOutboxRow(event: DomainEvent): OutboxEventRow {
  return {
    id: event.id,
    event_name: event.name,
    event_version: event.version,
    occurred_at: event.occurredAt.toISOString(),
    organization_id: event.organizationId,
    actor_type: event.actor.type,
    actor_id: event.actor.id,
    correlation_id: event.correlationId,
    causation_id: event.causationId,
    payload: event.payload,
  };
}
