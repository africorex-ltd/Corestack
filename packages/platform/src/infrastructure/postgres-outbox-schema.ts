/**
 * `platform.outbox` schema bootstrap (E03-T10; DB design §3; ADR-0009).
 * Ships under `./postgres` (ADR-0010).
 *
 * Creates, idempotently:
 * - `platform.outbox` — partitioned monthly by `occurred_at`, exactly the
 *   columns DB design §3 specifies. Postgres requires the partition key
 *   to be part of any primary key on a partitioned table, so the physical
 *   PK is `(id, occurred_at)` — `id` remains the event's sole logical
 *   identity; this is an unavoidable Postgres constraint for partitioning,
 *   not a change to the designed schema's meaning.
 * - The current month's partition **plus one month ahead**, so the outbox
 *   is immediately writable across a month rollover without depending on
 *   the ongoing partition-maintenance job (E03-T03, deferred — its job is
 *   keeping *future* periods created; this bootstrap only guarantees the
 *   outbox works the moment it's stood up).
 * - `platform.outbox_checkpoints` and `platform.processed_events`, exactly
 *   as designed (one row per consumer; absence of a row means "never
 *   processed anything," mirroring T02's `getState` convention — no row
 *   with null placeholder columns).
 * - The two designed indexes (`(occurred_at, id)` for relay scan order,
 *   `(organization_id, occurred_at)`), created on the partitioned parent
 *   so Postgres propagates them to every partition automatically.
 *
 * Append-only enforcement (DB design §3: "UPDATE/DELETE privileges revoked
 * from the application role") is applied **only when `applicationRole` is
 * given** — the full two-role model (platform vs. application) is E03-T30's
 * job; this bootstrap exposes the mechanism now so callers who already
 * have a role name can use it immediately, without inventing T30's
 * broader role architecture ahead of schedule.
 */

import type { Sql } from "postgres";

import { computeMonthlyPartitionBounds } from "../domain/outbox-partition.js";
import { assertSafeSqlIdentifier } from "../domain/sql-identifier.js";
import { ensurePlatformSchema } from "./ensure-platform-schema.js";

export interface EnsureOutboxSchemaOptions {
  /** Reference instant for computing which monthly partitions must exist; defaults to now. */
  readonly referenceDate?: Date;
  /**
   * If given, `UPDATE`/`DELETE` on `platform.outbox` are revoked from this
   * role, enforcing append-only at the database level. Validated as a safe
   * SQL identifier before interpolation (roles cannot be bound as query
   * parameters).
   */
  readonly applicationRole?: string;
}

export async function ensureOutboxSchema(
  sql: Sql,
  options: EnsureOutboxSchemaOptions = {},
): Promise<void> {
  await ensurePlatformSchema(sql);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS platform.outbox (
      id uuid NOT NULL,
      event_name text NOT NULL,
      event_version smallint NOT NULL,
      occurred_at timestamptz NOT NULL,
      organization_id uuid NULL,
      actor_type text NOT NULL CHECK (actor_type IN ('user', 'api_key', 'system')),
      actor_id uuid NULL,
      correlation_id uuid NOT NULL,
      causation_id uuid NULL,
      payload jsonb NOT NULL,
      PRIMARY KEY (id, occurred_at)
    ) PARTITION BY RANGE (occurred_at)
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS outbox_occurred_at_id_idx ON platform.outbox (occurred_at, id)
  `);
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS outbox_org_occurred_at_idx ON platform.outbox (organization_id, occurred_at)
  `);

  const bounds = computeMonthlyPartitionBounds(options.referenceDate ?? new Date(), 1);
  for (const bound of bounds) {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS platform.${bound.name} PARTITION OF platform.outbox
        FOR VALUES FROM ('${bound.from}') TO ('${bound.to}')
    `);
  }

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS platform.outbox_checkpoints (
      consumer text PRIMARY KEY,
      last_occurred_at timestamptz NOT NULL,
      last_event_id uuid NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS platform.processed_events (
      consumer text NOT NULL,
      event_id uuid NOT NULL,
      processed_at timestamptz NOT NULL,
      PRIMARY KEY (consumer, event_id)
    )
  `);

  if (options.applicationRole !== undefined) {
    assertSafeSqlIdentifier(options.applicationRole, "applicationRole");
    await sql.unsafe(`REVOKE UPDATE, DELETE ON platform.outbox FROM ${options.applicationRole}`);
  }
}
