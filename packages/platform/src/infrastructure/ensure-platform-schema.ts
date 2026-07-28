/**
 * Shared `CREATE SCHEMA IF NOT EXISTS platform` bootstrap — every
 * `platform.*` table's schema is created through this one function so
 * multiple bootstraps (migration tracking, T02; outbox, T10) never
 * duplicate the same idempotent DDL statement.
 */

import type { Sql } from "postgres";

export async function ensurePlatformSchema(sql: Sql): Promise<void> {
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS platform`);
}
