/**
 * Shared DDL for creating `platform.outbox` monthly partitions (E03-T10,
 * reused by E03-T03's maintenance job) — extracted so the bootstrap and
 * the ongoing maintenance job never let their partition-creation DDL
 * drift apart.
 */
import type { Sql } from "postgres";

import type { PartitionBounds } from "../domain/outbox-partition.js";

export async function createOutboxPartitions(
  sql: Sql,
  bounds: readonly PartitionBounds[],
): Promise<void> {
  for (const bound of bounds) {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS platform.${bound.name} PARTITION OF platform.outbox
        FOR VALUES FROM ('${bound.from}') TO ('${bound.to}')
    `);
  }
}
