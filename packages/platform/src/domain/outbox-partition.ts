/**
 * Monthly partition bounds for `platform.outbox` (E03-T10; DB design §3:
 * "partitioned monthly by occurred_at"). Pure date arithmetic — no I/O, no
 * Node builtins — so the boundary computation is testable without Postgres
 * and reusable by both the initial bootstrap (this task) and the ongoing
 * partition-maintenance job (E03-T03, deferred: "create next 2 periods
 * ahead of time").
 */

export interface PartitionBounds {
  /** e.g. "outbox_2026_07" — sortable, unambiguous. */
  readonly name: string;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  readonly from: string;
  /** Exclusive upper bound, `YYYY-MM-DD`. */
  readonly to: string;
}

function firstOfMonth(reference: Date, monthOffset: number): Date {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + monthOffset, 1));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
    bounds.push({ name, from: isoDate(start), to: isoDate(end) });
  }
  return bounds;
}
