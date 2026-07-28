/**
 * Postgres adapters for the readiness checks (E03-T23;
 * docs/platform/health-contract.md). Ships under `./postgres` (ADR-0010).
 */
import type { Sql } from "postgres";

import type { DatabasePingPort, MigrationsStatusPort } from "../application/health-readiness.js";

export class PostgresDatabasePing implements DatabasePingPort {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async ping(): Promise<{ readonly latencyMs: number }> {
    const start = performance.now();
    await this.#sql`SELECT 1`;
    return { latencyMs: performance.now() - start };
  }

  /** The database server's own clock — used for clock-skew detection, not application timestamps. */
  async now(): Promise<Date> {
    const [row] = await this.#sql<{ now: Date }[]>`SELECT now()`;
    if (row === undefined) throw new Error("SELECT now() returned no row");
    return row.now;
  }
}

export class PostgresMigrationsStatus implements MigrationsStatusPort {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async appliedVersions(): Promise<ReadonlyMap<string, number>> {
    const rows = await this.#sql<{ module: string; version: number }[]>`
      SELECT module, version FROM platform.module_migrations
    `;
    return new Map(rows.map((row) => [row.module, row.version]));
  }
}
