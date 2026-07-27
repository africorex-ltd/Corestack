/**
 * The `Cache` port (Architecture §12).
 *
 * Caching is opt-in per module feature; correctness rules are normative:
 * caches are never a source of truth, never hold unhashed secrets, and
 * invalidation happens by **key versioning** (`versionedKey`) — bump the
 * version, never enumerate keys. Security-critical revocations must bypass
 * the cache entirely (Architecture §12 "forbidden uses").
 */

import { type Clock, SystemClock } from "./clock.js";

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * The invalidation-by-versioning key scheme: `ns:v42:subject`. Readers build
 * keys from the current version (e.g. `rbac.authz_versions`); a version bump
 * makes every stale entry unreachable — no enumeration, no races.
 */
export function versionedKey(
  namespace: string,
  version: number | bigint | string,
  key: string,
): string {
  return `${namespace}:v${String(version)}:${key}`;
}

interface CacheEntry {
  readonly value: unknown;
  readonly expiresAt: number;
}

/**
 * Reference single-node adapter: TTL + LRU bound. Suitable for one-process
 * deployments and tests; multi-node deployments use the Redis adapter
 * (same contract suite).
 */
export class InMemoryLruCache implements Cache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #maxEntries: number;
  readonly #clock: Clock;

  constructor(options: { maxEntries?: number; clock?: Clock } = {}) {
    this.#maxEntries = options.maxEntries ?? 1000;
    this.#clock = options.clock ?? new SystemClock();
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.#clock.now().getTime()) {
      this.#entries.delete(key);
      return undefined;
    }
    // Refresh recency: Map iteration order is insertion order.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: this.#clock.now().getTime() + ttlMs });
    if (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (!oldest.done) this.#entries.delete(oldest.value);
    }
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }
}
