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
import type { CapturedLogEntry } from "../src/logger.js";

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

defineRateLimiterContractSuite(harness, (clock) => new InMemoryRateLimiter({ clock }));

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
