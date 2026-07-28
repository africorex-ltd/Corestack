/**
 * Monthly partition bounds for `platform.outbox` (E03-T10; DB design §3:
 * "partitioned monthly by occurred_at"). Pure date arithmetic — no I/O, no
 * Node builtins — so the boundary computation is testable without Postgres
 * and reusable by both the initial bootstrap (this task) and the ongoing
 * partition-maintenance job (E03-T03: "create next 2 periods ahead of time").
 */

export interface PartitionBounds {
  /** e.g. "outbox_2026_07" — sortable, unambiguous. */
  readonly name: string;
  /** Inclusive lower bound, an explicit-UTC-offset instant (`YYYY-MM-DDT00:00:00+00:00`). */
  readonly from: string;
  /** Exclusive upper bound, an explicit-UTC-offset instant (`YYYY-MM-DDT00:00:00+00:00`). */
  readonly to: string;
}

function firstOfMonth(reference: Date, monthOffset: number): Date {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + monthOffset, 1));
}

/**
 * A bare `YYYY-MM-DD` literal in a `PARTITION OF ... FOR VALUES FROM/TO`
 * clause is parsed using the DDL session's `TimeZone` setting, not UTC —
 * verified against real Postgres: under `TimeZone='America/New_York'`, a
 * `'2026-07-01'` bound actually starts at `2026-07-01T04:00:00Z`, silently
 * shifting the partition and causing inserts for the first few hours of
 * the month (UTC) to fail with "no partition ... found". An explicit
 * `+00:00` offset makes the literal an unambiguous instant regardless of
 * the session's TimeZone.
 */
function isoInstant(date: Date): string {
  return `${date.toISOString().slice(0, 10)}T00:00:00+00:00`;
}

/**
 * Bounds for the month containing `referenceDate` plus `monthsAhead`
 * subsequent months (0 = current month only). The bootstrap (T10) uses
 * `monthsAhead: 1` so the outbox is immediately writable across a month
 * rollover without waiting on T03's maintenance job.
 */
export function computeMonthlyPartitionBounds(
  referenceDate: Date,
  monthsAhead: number,
): readonly PartitionBounds[] {
  const bounds: PartitionBounds[] = [];
  for (let offset = 0; offset <= monthsAhead; offset++) {
    const start = firstOfMonth(referenceDate, offset);
    const end = firstOfMonth(referenceDate, offset + 1);
    const name = `outbox_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    bounds.push({ name, from: isoInstant(start), to: isoInstant(end) });
  }
  return bounds;
}

const PARTITION_NAME_PATTERN = /^outbox_(\d{4})_(\d{2})$/;

/**
 * The exclusive upper bound (UTC month start of the following month) a
 * partition name like `outbox_2026_07` denotes — the inverse of the name
 * this module generates. Returns `null` for any name that doesn't match
 * the pattern (E03-T03's maintenance job skips those rather than guessing
 * at bounds for a partition it didn't create, e.g. one attached by hand).
 */
export function partitionUpperBound(partitionName: string): Date | null {
  const match = PARTITION_NAME_PATTERN.exec(partitionName);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return new Date(Date.UTC(year, month, 1));
}
