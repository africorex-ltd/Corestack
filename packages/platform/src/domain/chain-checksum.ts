/**
 * Migration-history chain checksum (E03-T02; DB design §3, §18).
 *
 * `platform.module_migrations` stores exactly **one row per module**
 * (`module PK, version, applied_at, checksum`) — not one row per applied
 * migration file. Drift detection therefore cannot compare a stored
 * per-file checksum against each file individually; instead the single
 * `checksum` column holds a **cumulative hash over the whole applied
 * history in order** (`sha256(checksum_1 + "\n" + checksum_2 + ... )`).
 * Any edit to any previously-applied migration file changes its own T01
 * checksum, which changes every chain checksum computed from that point
 * forward — so comparing the freshly-recomputed chain checksum for
 * "migrations 1..N on disk today" against the recorded checksum for
 * version N detects drift anywhere in the history, using the schema
 * exactly as designed (no additional table or column).
 *
 * Pure — reuses the same WebCrypto SHA-256 primitive as T01's
 * `computeChecksum`, no I/O, no Node builtins.
 */

export async function computeChainChecksum(checksumsInOrder: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(checksumsInOrder.join("\n"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A stable, deterministic 63-bit non-negative key for Postgres advisory
 * locks (`pg_advisory_lock(bigint)` — signed 64-bit). Derived from the
 * module name so every runner process computes the identical key without
 * any shared registry; masked to 63 bits (top bit cleared) to guarantee
 * the value always fits Postgres's signed bigint range.
 */
export async function computeAdvisoryLockKey(moduleName: string): Promise<bigint> {
  const bytes = new TextEncoder().encode(`platform.module_migrations:${moduleName}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return BigInt(`0x${hex}`) & 0x7fffffffffffffffn;
}
