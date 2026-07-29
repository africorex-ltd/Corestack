/**
 * `platform.rate_limits` schema bootstrap (E03-T41; DB §3). Ships under
 * `./postgres` (ADR-0010).
 */
import type { Sql } from "postgres";

import { ensurePlatformSchema } from "./ensure-platform-schema.js";

export async function ensureRateLimitsSchema(sql: Sql): Promise<void> {
  await ensurePlatformSchema(sql);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS platform.rate_limits (
      bucket text NOT NULL,
      window_start timestamptz NOT NULL,
      count integer NOT NULL,
      PRIMARY KEY (bucket, window_start)
    )
  `);
}
