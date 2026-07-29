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
  defineRateLimiterContractSuite,
  type SuiteHarness,
} from "../src/testing/index.js";

const harness: SuiteHarness = { describe, it, expect, beforeEach, afterEach };

describe("Logger", () => {
  it("CaptureLogger records entries with child fields merged into a shared sink", () => {
    const root = new CaptureLogger();
    const child = root.child({ module: "auth", correlationId: "c1" });
    child.info("logged in", { userId: "u1" });
    child.child({ deep: true }).warn("nested");
    root.error("root level");

    expect(root.entries).toEqual([
      {
        level: "info",
        message: "logged in",
        fields: { module: "auth", correlationId: "c1", userId: "u1" },
      },
      {
        level: "warn",
        message: "nested",
        fields: { module: "auth", correlationId: "c1", deep: true },
      },
      { level: "error", message: "root level", fields: {} },
    ]);
  });

  it("NoopLogger swallows everything and children are itself", () => {
    const logger = new NoopLogger();
    expect(logger.child({ a: 1 })).toBe(logger);
    expect(() => logger.fatal("nothing happens")).not.toThrow();
  });
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

describe("IdempotencyStore", () => {
  const ORG_A = "org-a";
  const ORG_B = "org-b";

  it("a fresh (org, scope, key) starts, then completes and replays with the same body", async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
      outcome: "started",
    });

    await store.complete(ORG_A, "orders", "k1", "hash-a", { orderId: "o1" }, 60_000);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
      outcome: "replay",
      response: { orderId: "o1" },
    });
  });

  it("a second caller mid-flight sees inProgress, not started or replay", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
      outcome: "inProgress",
    });
  });

  it("the same key with a different body is a conflict, in-progress or completed", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-b", 60_000)).toEqual({
      outcome: "conflict",
    });

    await store.complete(ORG_A, "orders", "k1", "hash-a", { orderId: "o1" }, 60_000);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-b", 60_000)).toEqual({
      outcome: "conflict",
    });
  });

  it("scopes are independent — the same key in a different scope starts fresh", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000);
    expect(await store.begin(ORG_A, "refunds", "k1", "hash-a", 60_000)).toEqual({
      outcome: "started",
    });
  });

  it("SECURITY: two organizations presenting the identical (scope, key, requestHash) never share a lock or a replayed response", async () => {
    const store = new InMemoryIdempotencyStore();

    // Org A completes a request with a client-supplied Idempotency-Key
    // that happens to collide with what Org B will independently choose.
    expect(
      await store.begin(ORG_A, "orders:create", "same-client-key", "same-body-hash", 60_000),
    ).toEqual({
      outcome: "started",
    });
    await store.complete(
      ORG_A,
      "orders:create",
      "same-client-key",
      "same-body-hash",
      { orderId: "org-a-secret-order" },
      60_000,
    );

    // Org B, presenting the identical (scope, key, requestHash), must get
    // its own fresh lock — never Org A's stored response.
    const orgBResult = await store.begin(
      ORG_B,
      "orders:create",
      "same-client-key",
      "same-body-hash",
      60_000,
    );
    expect(orgBResult).toEqual({ outcome: "started" });

    // Confirm Org A's own replay is unaffected by Org B's activity.
    expect(
      await store.begin(ORG_A, "orders:create", "same-client-key", "same-body-hash", 60_000),
    ).toEqual({ outcome: "replay", response: { orderId: "org-a-secret-order" } });
  });

  it("an expired in_progress lock is reclaimable — recovers a crashed caller's key", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));
    const store = new InMemoryIdempotencyStore({ clock });
    await store.begin(ORG_A, "orders", "k1", "hash-a", 1000); // caller "crashes", never completes

    clock.advance(999);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 1000)).toEqual({
      outcome: "inProgress",
    });
    clock.advance(1);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 1000)).toEqual({
      outcome: "started",
    });
  });

  it("an expired completed entry is no longer replayable — starts fresh, not replay", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));
    const store = new InMemoryIdempotencyStore({ clock });
    await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000);
    await store.complete(ORG_A, "orders", "k1", "hash-a", { orderId: "o1" }, 1000);

    clock.advance(1001);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
      outcome: "started",
    });
  });

  it("complete() is a no-op once the lock has expired and been reclaimed by a newer attempt", async () => {
    const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));
    const store = new InMemoryIdempotencyStore({ clock });
    await store.begin(ORG_A, "orders", "k1", "hash-a", 1000); // attempt #1

    clock.advance(1001); // attempt #1's lock expires, unreclaimed
    await store.begin(ORG_A, "orders", "k1", "hash-b", 60_000); // attempt #2 reclaims with a new body

    // attempt #1's stale complete() must not clobber attempt #2's in-progress state
    await store.complete(ORG_A, "orders", "k1", "hash-a", { stale: true }, 60_000);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-b", 60_000)).toEqual({
      outcome: "inProgress",
    });
  });

  it("complete() is a no-op if called before begin() ever ran", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.complete(ORG_A, "orders", "k1", "hash-a", { orderId: "o1" }, 60_000);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
      outcome: "started",
    });
  });

  it("null organizationId (platform-scoped) is independent from any real organization", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin(null, "orders", "k1", "hash-a", 60_000);
    expect(await store.begin(ORG_A, "orders", "k1", "hash-a", 60_000)).toEqual({
      outcome: "started",
    });
  });
});

describe("Encrypter (WebCrypto AES-256-GCM)", () => {
  const keyA = new Uint8Array(32).fill(1);
  const keyB = new Uint8Array(32).fill(2);
  const plaintext = new TextEncoder().encode("totp-seed-material");

  it("round-trips and uses the current key id", async () => {
    const encrypter = await WebCryptoAesGcmEncrypter.create(new Map([["k1", keyA]]), "k1");
    const encrypted = await encrypter.encrypt(plaintext);

    expect(encrypted.keyId).toBe("k1");
    expect(encrypted.iv).toHaveLength(12);
    expect(await encrypter.decrypt(encrypted)).toEqual(plaintext);
  });

  it("rotation: old key still decrypts, new encrypts under new id", async () => {
    const before = await WebCryptoAesGcmEncrypter.create(new Map([["k1", keyA]]), "k1");
    const legacy = await before.encrypt(plaintext);

    const after = await WebCryptoAesGcmEncrypter.create(
      new Map([
        ["k1", keyA],
        ["k2", keyB],
      ]),
      "k2",
    );
    expect(await after.decrypt(legacy)).toEqual(plaintext);
    expect((await after.encrypt(plaintext)).keyId).toBe("k2");
  });

  it("tampered ciphertext fails without detail", async () => {
    const encrypter = await WebCryptoAesGcmEncrypter.create(new Map([["k1", keyA]]), "k1");
    const encrypted = await encrypter.encrypt(plaintext);
    const tampered = new Uint8Array(encrypted.ciphertext);
    tampered[0] = (tampered[0] as number) ^ 0xff;

    await expect(encrypter.decrypt({ ...encrypted, ciphertext: tampered })).rejects.toThrow(
      CryptoFailureError,
    );
  });

  it("unknown key id and bad key material are rejected", async () => {
    const encrypter = await WebCryptoAesGcmEncrypter.create(new Map([["k1", keyA]]), "k1");
    const encrypted = await encrypter.encrypt(plaintext);
    await expect(encrypter.decrypt({ ...encrypted, keyId: "ghost" })).rejects.toThrow(
      CryptoFailureError,
    );

    await expect(
      WebCryptoAesGcmEncrypter.create(new Map([["short", new Uint8Array(16)]]), "short"),
    ).rejects.toThrow(CryptoFailureError);
    await expect(
      WebCryptoAesGcmEncrypter.create(new Map([["k1", keyA]]), "missing"),
    ).rejects.toThrow(CryptoFailureError);
  });
});
