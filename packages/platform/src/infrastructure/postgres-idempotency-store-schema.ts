/**
 * `platform.idempotency_keys` schema bootstrap (E03-T43; DB §3). Ships under
 * `./postgres` (ADR-0010).
 */
import type { Sql } from "postgres";

import { ensurePlatformSchema } from "./ensure-platform-schema.js";

export async function ensureIdempotencyKeysSchema(sql: Sql): Promise<void> {
  await ensurePlatformSchema(sql);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS platform.idempotency_keys (
      scope text NOT NULL,
      key text NOT NULL,
      request_hash text NOT NULL,
      response_snapshot jsonb,
      status text NOT NULL CHECK (status IN ('in_progress', 'completed')),
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (scope, key)
    )
  `);
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at_idx
      ON platform.idempotency_keys (expires_at)
  `);
}
