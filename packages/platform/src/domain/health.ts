/**
 * Health/readiness vocabulary (E03-T23; docs/platform/health-contract.md).
 * Pure types and ordering logic — no I/O, no Node builtins.
 */

/** Per-check status. Mirrors `ModuleHealthStatus`'s three-level shape, renamed for the readiness vocabulary (contract §Terms). */
export type CheckStatus = "ok" | "degraded" | "failing";

/** Top-level readiness verdict. */
export type ReadinessLevel = "ready" | "degraded" | "unready";

const CHECK_STATUS_RANK: Readonly<Record<CheckStatus, number>> = { ok: 0, degraded: 1, failing: 2 };
const READINESS_LEVEL_RANK: Readonly<Record<ReadinessLevel, number>> = {
  ready: 0,
  degraded: 1,
  unready: 2,
};

/** Worst (highest-severity) of any given check statuses; `ok` if given none. */
export function worstCheckStatus(statuses: readonly CheckStatus[]): CheckStatus {
  let worst: CheckStatus = "ok";
  for (const status of statuses) {
    if (CHECK_STATUS_RANK[status] > CHECK_STATUS_RANK[worst]) worst = status;
  }
  return worst;
}

/** Maps a single check's status onto the top-level readiness scale. */
export function checkStatusToReadinessLevel(status: CheckStatus): ReadinessLevel {
  if (status === "failing") return "unready";
  if (status === "degraded") return "degraded";
  return "ready";
}

/** Maps a `ModuleHealthStatus` (T20) onto the readiness scale, per health-contract.md's folding rule. */
export function moduleHealthStatusToReadinessLevel(
  status: "healthy" | "degraded" | "unhealthy",
): ReadinessLevel {
  if (status === "unhealthy") return "unready";
  if (status === "degraded") return "degraded";
  return "ready";
}

/** Worst (highest-severity) of any given readiness levels; `ready` if given none. */
export function worstReadinessLevel(levels: readonly ReadinessLevel[]): ReadinessLevel {
  let worst: ReadinessLevel = "ready";
  for (const level of levels) {
    if (READINESS_LEVEL_RANK[level] > READINESS_LEVEL_RANK[worst]) worst = level;
  }
  return worst;
}
