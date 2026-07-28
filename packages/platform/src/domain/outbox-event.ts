/**
 * Maps a kernel `DomainEvent` (ADR-0009) to the exact `platform.outbox`
 * row shape (E03-T10; DB design §3), and back. Pure — no I/O — so the
 * mapping is testable without Postgres and reusable by any adapter, not
 * just the Postgres one this task ships.
 */
import type { ActorType, DomainEvent } from "@corestack/kernel";

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

/**
 * Shape of a row read back from `platform.outbox` (E03-T12; the relay's
 * read side). `occurred_at` is a `Date` here, not the ISO string
 * `OutboxEventRow` uses for inserts: `postgres.js` auto-parses a
 * `timestamptz` column into a JS `Date` on `SELECT`, so the two
 * directions genuinely have different shapes.
 */
export interface OutboxTableRow {
  readonly id: string;
  readonly event_name: string;
  readonly event_version: number;
  readonly occurred_at: Date;
  readonly organization_id: string | null;
  readonly actor_type: string;
  readonly actor_id: string | null;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly payload: unknown;
}

export function fromOutboxRow(row: OutboxTableRow): DomainEvent {
  return Object.freeze({
    id: row.id,
    name: row.event_name,
    version: row.event_version,
    occurredAt: row.occurred_at,
    organizationId: row.organization_id,
    actor: Object.freeze({ type: row.actor_type as ActorType, id: row.actor_id }),
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    payload: row.payload,
  });
}
