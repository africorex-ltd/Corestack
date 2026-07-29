/**
 * The `Encrypter` port's contract suite (E04, following E04-T01's
 * framework). Covers what `encrypter.ts`'s doc comment makes normative:
 * round-trip correctness, `encrypt` always tagging the current key id,
 * rotation (an old key id still decrypts, a new encryption uses the new
 * id), tamper detection, unknown/wrong-key rejection, IV/ciphertext
 * uniqueness across calls, and that no failure path ever leaks plaintext
 * in its error.
 *
 * Only `WebCryptoAesGcmEncrypter` exists today; the port doc names a
 * future KMS-backed adapter as a planned extension point (not yet built,
 * same status as `Logger`'s planned pino adapter) — see
 * `docs/testing/adapter-certification-matrix.md`.
 *
 * The factory mirrors `WebCryptoAesGcmEncrypter.create`'s actual shape
 * (a raw key set plus which id is current) rather than a bare `() => T`,
 * because the rotation contract inherently needs two related instances
 * built over overlapping key sets — any real `Encrypter` adapter,
 * WebCrypto or KMS-backed, needs this same construction shape.
 */
import type { Encrypter } from "../encrypter.js";
import type { SuiteHarness } from "./harness.js";

export interface EncrypterContractFactory {
  (keys: ReadonlyMap<string, Uint8Array>, currentKeyId: string): Encrypter | Promise<Encrypter>;
}

function fixedKey(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

export function defineEncrypterContractSuite(
  harness: SuiteHarness,
  factory: EncrypterContractFactory,
): void {
  const { describe, it, expect } = harness;
  const plaintext = new TextEncoder().encode("totp-seed-material");

  describe("Encrypter contract", () => {
    it("round-trips and tags the encrypted value with the current key id", async () => {
      const encrypter = await factory(new Map([["k1", fixedKey(1)]]), "k1");
      const encrypted = await encrypter.encrypt(plaintext);

      expect(encrypted.keyId).toBe("k1");
      expect(await encrypter.decrypt(encrypted)).toEqual(plaintext);
    });

    it("rotation: an old key id still decrypts under a newer encrypter; new encryptions use the new id", async () => {
      const before = await factory(new Map([["k1", fixedKey(1)]]), "k1");
      const legacy = await before.encrypt(plaintext);

      const after = await factory(
        new Map([
          ["k1", fixedKey(1)],
          ["k2", fixedKey(2)],
        ]),
        "k2",
      );
      expect(await after.decrypt(legacy)).toEqual(plaintext);
      expect((await after.encrypt(plaintext)).keyId).toBe("k2");
    });

    it("SECURITY: tampered ciphertext is rejected, and the failure never includes the plaintext", async () => {
      const encrypter = await factory(new Map([["k1", fixedKey(1)]]), "k1");
      const encrypted = await encrypter.encrypt(plaintext);
      const tampered = new Uint8Array(encrypted.ciphertext);
      tampered[0] = (tampered[0] ?? 0) ^ 0xff;

      const plaintextText = new TextDecoder().decode(plaintext);
      await expect(encrypter.decrypt({ ...encrypted, ciphertext: tampered })).rejects.toSatisfy(
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          return !message.includes(plaintextText);
        },
      );
    });

    it("SECURITY: an unknown key id is rejected, and the failure never includes the plaintext", async () => {
      const encrypter = await factory(new Map([["k1", fixedKey(1)]]), "k1");
      const encrypted = await encrypter.encrypt(plaintext);

      const plaintextText = new TextDecoder().decode(plaintext);
      await expect(
        encrypter.decrypt({ ...encrypted, keyId: "ghost-key-id" }),
      ).rejects.toSatisfy((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return !message.includes(plaintextText);
      });
    });

    it("each encryption uses a fresh IV — two encryptions of the same plaintext never collide", async () => {
      const encrypter = await factory(new Map([["k1", fixedKey(1)]]), "k1");
      const first = await encrypter.encrypt(plaintext);
      const second = await encrypter.encrypt(plaintext);

      expect(first.iv).not.toEqual(second.iv);
      expect(first.ciphertext).not.toEqual(second.ciphertext);
      expect(await encrypter.decrypt(first)).toEqual(plaintext);
      expect(await encrypter.decrypt(second)).toEqual(plaintext);
    });
  });
}
