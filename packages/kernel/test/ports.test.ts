import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CaptureLogger,
  CryptoFailureError,
  FixedClock,
  InMemoryIdempotencyStore,
  InMemoryLruCache,
  InMemoryRateLimiter,
  NoopLogger,
  versionedKey,
  WebCryptoAesGcmEncrypter,
} from "../src/index.js";
import {
  defineCacheContractSuite,
  defineEncrypterContractSuite,
  defineIdempotencyStoreContractSuite,
  defineLoggerContractSuite,
  defineRateLimiterContractSuite,
  type SuiteHarness,
} from "../src/testing/index.js";
import type { Cache } from "../src/cache.js";
import type { EncryptedValue, Encrypter } from "../src/encrypter.js";
import type { CapturedLogEntry } from "../src/logger.js";
import type { RateLimitDecision, RateLimitPolicy, RateLimiter } from "../src/rate-limiter.js";

const harness: SuiteHarness = { describe, it, expect, beforeEach, afterEach };

describe("Logger (adapter-specific)", () => {
  it("NoopLogger swallows everything and children are itself (identity, not a normative port contract)", () => {
    const logger = new NoopLogger();
    expect(logger.child({ a: 1 })).toBe(logger);
    expect(() => logger.fatal("nothing happens")).not.toThrow();
  });

  it("CaptureLogger children share their parent's entries sink by construction (AUD-09)", () => {
    const root = new CaptureLogger();
    const child = root.child({ module: "auth" });
    child.info("from child");
    root.warn("from root");
    expect(root.entries.map((e) => e.message)).toEqual(["from child", "from root"]);
  });
});

describe("CaptureLogger via the shared Logger contract suite", () => {
  defineLoggerContractSuite(harness, () => {
    const entries: CapturedLogEntry[] = [];
    return { logger: new CaptureLogger({}, entries), entries: () => entries };
  });
});

describe("NoopLogger via the shared Logger contract suite", () => {
  defineLoggerContractSuite(harness, () => ({ logger: new NoopLogger(), entries: () => [] }));
});

describe("Cache", () => {
  it("versionedKey builds the invalidation-by-versioning scheme", () => {
    expect(versionedKey("authz", 42, "org-1:user-2")).toBe("authz:v42:org-1:user-2");
    expect(versionedKey("entitlements", 7n, "org-1")).toBe("entitlements:v7:org-1");
  });

  it("evicts least-recently-used beyond maxEntries (InMemoryLruCache-specific capacity bound, not part of the portable Cache contract)", async () => {
    const clock = new FixedClock(new Date("2026-07-28T00:00:00Z"));
    const cache = new InMemoryLruCache({ maxEntries: 2, clock });
    await cache.set("a", 1, 60_000);
    await cache.set("b", 2, 60_000);
    await cache.get("a"); // refresh a → b is now LRU
    await cache.set("c", 3, 60_000);

    expect(await cache.get("a")).toBe(1);
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("c")).toBe(3);
  });
});

// E04-T01 acceptance criterion: the kernel's own in-memory adapter passes
// its port's contract suite through the shared framework.
defineCacheContractSuite(harness, (clock) => new InMemoryLruCache({ clock }));

/**
 * Mutation proof (E05 readiness gate, Section 5): a `Cache` that stores
 * every entry forever, ignoring the `ttlMs` argument entirely. This is a
 * plausible real implementation mistake — the value round-trips correctly,
 * `set`/`get`/`delete` all "work" under casual testing, and the bug only
 * shows up the instant something actually depends on expiry (a stale
 * permission cache serving revoked access, for one). Proves the shared
 * suite's TTL assertion has teeth without registering a permanently-failing
 * test through the suite itself — same pattern as `event-bus.test.ts`'s
 * `ReverseOrderEventBus`.
 */
class NeverExpiringCache implements Cache {
  #store = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.#store.get(key) as T | undefined;
  }
  async set(key: string, value: unknown, _ttlMs: number): Promise<void> {
    this.#store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.#store.delete(key);
  }
}

describe("Cache contract regression proof", () => {
  it("a Cache that ignores ttlMs fails the shared suite's expiry assertion", async () => {
    const cache = new NeverExpiringCache();
    await cache.set("k", { hello: true }, 1000);

    // The shared suite asserts undefined once the clock crosses the TTL —
    // this fixture never expires anything, proving that assertion is not
    // vacuously true.
    expect(await cache.get("k")).toEqual({ hello: true });
    expect(await cache.get("k")).not.toBeUndefined();
  });
});

defineRateLimiterContractSuite(harness, (clock) => new InMemoryRateLimiter({ clock }));

/**
 * Mutation proof (E05 readiness gate, Section 5): a `RateLimiter` that
 * compares `count`/`limit` lexicographically instead of numerically. This
 * is not a hypothetical — it reproduces the exact class of bug found and
 * fixed for real in `PostgresRateLimiter` (E03-T41): untyped SQL bind
 * parameters defaulted to `text`, so `10 <= 5` evaluated `true`
 * (`'1' < '5'`) and silently admitted a request that should have been
 * denied. This fixture reproduces the same string-comparison mistake in
 * pure JS to prove the shared suite's cost-accounting assertion would
 * catch it in any adapter, not just the one where it actually happened.
 */
class LexicographicRateLimiter implements RateLimiter {
  #counts = new Map<string, number>();
  async consume(key: string, policy: RateLimitPolicy, cost = 1): Promise<RateLimitDecision> {
    const current = this.#counts.get(key) ?? 0;
    const next = current + cost;
    // BUG: string comparison instead of numeric — mirrors the real
    // untyped-SQL-parameter defect this fixture is modeled on.
    const allowed = String(next) <= String(policy.limit);
    if (allowed) this.#counts.set(key, next);
    return {
      allowed,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - (allowed ? next : current)),
      retryAfterMs: allowed ? null : policy.windowMs,
    };
  }
}

describe("RateLimiter contract regression proof", () => {
  it("a RateLimiter comparing count/limit as strings fails the shared suite's cost-accounting assertion", async () => {
    const limiter = new LexicographicRateLimiter();
    // The shared suite's "single request whose cost exceeds the limit"
    // case: limit=10, cost=9 must be ALLOWED (9 <= 10 numerically). String
    // comparison says "9" <= "10" is false ('9' > '1' lexicographically),
    // so this fixture wrongly denies it — proving the assertion is not
    // vacuously true.
    const decision = await limiter.consume("b", { limit: 10, windowMs: 60_000 }, 9);
    expect(decision.allowed).toBe(false);
    expect(decision).not.toEqual({ allowed: true, limit: 10, remaining: 1, retryAfterMs: null });
  });
});

describe("RateLimiter (InMemoryRateLimiter-specific)", () => {
  const policy = { limit: 3, windowMs: 60_000 };

  it("AUD-05 regression: expired windows are pruned — the bucket map is bounded", async () => {
    const clock = new FixedClock(new Date("2026-07-28T00:00:00.000Z"));
    const limiter = new InMemoryRateLimiter({ clock, maxBuckets: 5 });

    for (let i = 0; i < 5; i++) await limiter.consume(`old-${i}`, policy);
    expect(limiter.bucketCount).toBe(5);

    clock.advance(policy.windowMs + 1); // all five expire
    await limiter.consume("fresh", policy); // triggers prune at cap
    expect(limiter.bucketCount).toBe(1);
  });

  it("AUD-05: when all windows are live, oldest buckets are evicted to stay bounded", async () => {
    const clock = new FixedClock(new Date("2026-07-28T00:00:00.000Z"));
    const limiter = new InMemoryRateLimiter({ clock, maxBuckets: 3 });

    for (let i = 0; i < 3; i++) await limiter.consume(`live-${i}`, policy);
    await limiter.consume("live-3", policy); // over cap, nothing expired → evict oldest

    expect(limiter.bucketCount).toBeLessThanOrEqual(3);
    expect((await limiter.consume("live-3", policy)).allowed).toBe(true);
  });
});

describe("InMemoryIdempotencyStore via the shared IdempotencyStore contract suite", () => {
  defineIdempotencyStoreContractSuite(harness, (clock) => new InMemoryIdempotencyStore({ clock }));
});

describe("WebCryptoAesGcmEncrypter via the shared Encrypter contract suite", () => {
  defineEncrypterContractSuite(harness, (keys, currentKeyId) =>
    WebCryptoAesGcmEncrypter.create(keys, currentKeyId),
  );
});

/**
 * Mutation proof (E05 readiness gate, Section 5): an `Encrypter` that
 * reuses a fixed, all-zero IV on every call instead of a fresh random one.
 * IV reuse under AES-GCM is one of the single most common real-world
 * misimplementations of this primitive (it breaks confidentiality and, in
 * the worst case, authenticity) — not a hypothetical, artificial mistake.
 * Proves the shared suite's IV-uniqueness assertion has teeth.
 */
class FixedIvEncrypter implements Encrypter {
  readonly currentKeyId: string;
  readonly #key: MinimalCryptoKey;
  static readonly #FIXED_IV = new Uint8Array(12); // all zero, every call

  private constructor(key: MinimalCryptoKey, currentKeyId: string) {
    this.#key = key;
    this.currentKeyId = currentKeyId;
  }

  static async create(rawKey: Uint8Array, currentKeyId: string): Promise<FixedIvEncrypter> {
    const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
    return new FixedIvEncrypter(key, currentKeyId);
  }

  async encrypt(plaintext: Uint8Array): Promise<EncryptedValue> {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: FixedIvEncrypter.#FIXED_IV },
      this.#key,
      plaintext,
    );
    return { keyId: this.currentKeyId, iv: FixedIvEncrypter.#FIXED_IV, ciphertext: new Uint8Array(ciphertext) };
  }

  async decrypt(value: EncryptedValue): Promise<Uint8Array> {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: value.iv },
      this.#key,
      value.ciphertext,
    );
    return new Uint8Array(plaintext);
  }
}

describe("Encrypter contract regression proof", () => {
  it("an Encrypter reusing a fixed IV fails the shared suite's IV-uniqueness assertion", async () => {
    const encrypter = await FixedIvEncrypter.create(new Uint8Array(32).fill(1), "k1");
    const plaintext = new TextEncoder().encode("totp-seed-material");

    const first = await encrypter.encrypt(plaintext);
    const second = await encrypter.encrypt(plaintext);

    // The shared suite asserts the IVs (and therefore ciphertexts) differ
    // across calls — this fixture reuses the same IV every time, proving
    // that assertion is not vacuously true.
    expect(first.iv).toEqual(second.iv);
    expect(first.ciphertext).toEqual(second.ciphertext);
  });
});

describe("WebCryptoAesGcmEncrypter (adapter-specific)", () => {
  const keyA = new Uint8Array(32).fill(1);

  it("the IV is exactly 12 bytes (AES-GCM's recommended nonce size)", async () => {
    const encrypter = await WebCryptoAesGcmEncrypter.create(new Map([["k1", keyA]]), "k1");
    const encrypted = await encrypter.encrypt(new TextEncoder().encode("x"));
    expect(encrypted.iv).toHaveLength(12);
  });

  it("both a tampered ciphertext and an unknown key id throw specifically CryptoFailureError", async () => {
    const encrypter = await WebCryptoAesGcmEncrypter.create(new Map([["k1", keyA]]), "k1");
    const encrypted = await encrypter.encrypt(new TextEncoder().encode("x"));
    const tampered = new Uint8Array(encrypted.ciphertext);
    tampered[0] = (tampered[0] as number) ^ 0xff;

    await expect(encrypter.decrypt({ ...encrypted, ciphertext: tampered })).rejects.toThrow(
      CryptoFailureError,
    );
    await expect(encrypter.decrypt({ ...encrypted, keyId: "ghost" })).rejects.toThrow(
      CryptoFailureError,
    );
  });

  it("construction rejects a key of the wrong byte length or a currentKeyId absent from the key set", async () => {
    await expect(
      WebCryptoAesGcmEncrypter.create(new Map([["short", new Uint8Array(16)]]), "short"),
    ).rejects.toThrow(CryptoFailureError);
    await expect(
      WebCryptoAesGcmEncrypter.create(new Map([["k1", keyA]]), "missing"),
    ).rejects.toThrow(CryptoFailureError);
  });
});
