/**
 * `platform.outbox` partition maintenance job (E03-T03; DB design §3:
 * "old partitions dropped per retention policy after all checkpoints
 * pass them"). Ships under `./postgres` (ADR-0010).
 *
 * A callable function, not a running daemon — there is no scheduler
 * module yet to wire it into (the blueprint's "Jobs Schema" module is a
 * separate, not-yet-built epic); a future CLI command or scheduled job
 * calls this the same way `ensureOutboxSchema` (E03-T10) is called at
 * boot rather than run as a service itself.
 *
 * Self-contained plain SQL — no `pg_partman` dependency. `pg_partman` is
 * documented in DB design §7 as an *optional convenience*; this design
 * intentionally doesn't require it so the outbox works identically on
 * any Postgres 16 instance, with `pg_partman` remaining a valid drop-in
 * replacement for an adopter who prefers it, not a requirement of this
 * package.
 *
 * Two independent responsibilities:
 * - **Create-ahead:** ensure the next `monthsAhead` (default 2, per the
 *   task's acceptance criteria) months' partitions exist, reusing the
 *   exact same DDL as E03-T10's bootstrap.
 * - **Retention-drop (opt-in):** only runs when `retentionMonths` is
 *   given. Absence of `retentionMonths` means "create-ahead only, no
 *   drop attempted" — this component never picks a default retention
 *   window itself (the approved design docs deliberately leave that
 *   policy open), and a destructive default would be the wrong failure
 *   mode for an operation that irreversibly deletes committed events.
 */
import type { Sql } from "postgres";

import { computeMonthlyPartitionBounds, partitionUpperBound } from "../domain/outbox-partition.js";
import {
  planPartitionDrops,
  type ExistingPartition,
} from "../domain/outbox-partition-retention.js";
import { createOutboxPartitions } from "./outbox-partition-ddl.js";

export interface MaintainOutboxPartitionsOptions {
  readonly referenceDate?: Date;
  /** How many months ahead of `referenceDate` must have partitions ready. Default 2. */
  readonly monthsAhead?: number;
  /**
   * How many whole months of history to keep before a partition becomes
   * retention-eligible. Omit to run create-ahead only and skip the drop
   * phase entirely — there is no default.
   */
  readonly retentionMonths?: number;
  /**
   * Every consumer this outbox is expected to serve. A partition is
   * droppable only once **all** of these have checkpoints past it —
   * missing this list (or omitting a real consumer from it) is the one
   * way this job could destroy events a consumer hasn't read yet.
   */
  readonly expectedConsumers?: readonly string[];
}

export interface OutboxPartitionMaintenanceReport {
  readonly created: readonly string[];
  readonly dropped: readonly string[];
  readonly blocked: readonly { readonly name: string; readonly reason: string }[];
}

async function listExistingPartitions(sql: Sql): Promise<ExistingPartition[]> {
  const rows = await sql<{ relname: string }[]>`
    SELECT child.relname
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    JOIN pg_namespace ns ON parent.relnamespace = ns.oid
    WHERE ns.nspname = 'platform' AND parent.relname = 'outbox'
  `;

  const partitions: ExistingPartition[] = [];
  for (const row of rows) {
    const to = partitionUpperBound(row.relname);
    // Skip anything not matching this module's own naming convention
    // (e.g. a partition attached by hand) rather than guessing at its
    // bounds by parsing Postgres's own partition-bound expression.
    if (to !== null) partitions.push({ name: row.relname, to });
  }
  return partitions;
}

function retentionCutoff(referenceDate: Date, retentionMonths: number): Date {
  return new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() - retentionMonths, 1),
  );
}

export async function maintainOutboxPartitions(
  sql: Sql,
  options: MaintainOutboxPartitionsOptions = {},
): Promise<OutboxPartitionMaintenanceReport> {
  const referenceDate = options.referenceDate ?? new Date();
  const monthsAhead = options.monthsAhead ?? 2;

  const bounds = computeMonthlyPartitionBounds(referenceDate, monthsAhead);
  const existingBefore = new Set((await listExistingPartitions(sql)).map((p) => p.name));
  await createOutboxPartitions(sql, bounds);
  const created = bounds.map((b) => b.name).filter((name) => !existingBefore.has(name));

  if (options.retentionMonths === undefined) {
    return { created, dropped: [], blocked: [] };
  }

  const expectedConsumers = options.expectedConsumers ?? [];
  const cutoff = retentionCutoff(referenceDate, options.retentionMonths);
  const partitions = await listExistingPartitions(sql);

  const checkpoints = new Map<string, Date | null>();
  if (expectedConsumers.length > 0) {
    const rows = await sql<{ consumer: string; last_occurred_at: Date }[]>`
      SELECT consumer, last_occurred_at FROM platform.outbox_checkpoints
      WHERE consumer IN ${sql(expectedConsumers)}
    `;
    for (const consumer of expectedConsumers) checkpoints.set(consumer, null);
    for (const row of rows) checkpoints.set(row.consumer, row.last_occurred_at);
  }

  const plan = planPartitionDrops(partitions, cutoff, expectedConsumers, checkpoints);

  for (const name of plan.droppable) {
    await sql.begin(async (tx) => {
      // Gated on what was *actually* dropped, not the configured
      // retention cutoff: if checkpoint safety blocked a sibling
      // partition, its processed_events rows must survive too, or a
      // later redelivery from that still-present partition would lose
      // its dedupe protection and duplicate an effect.
      await tx.unsafe(
        `DELETE FROM platform.processed_events WHERE event_id IN (SELECT id FROM platform.${name})`,
      );
      await tx.unsafe(`DROP TABLE platform.${name}`);
    });
  }

  return { created, dropped: plan.droppable, blocked: plan.blocked };
}
