/**
 * The `Encrypter` port (Architecture §42; DB rule 10).
 *
 * For **use-again secrets only** — values the platform must read back
 * (TOTP seeds, webhook signing secrets). Verify-only secrets are hashed,
 * never encrypted. Rotation semantics are part of the port contract:
 * `encrypt` always uses the current key; `decrypt` accepts any known key id,
 * so rotating means adding a new current key and re-encrypting lazily.
 */

import { CryptoFailureError } from "./errors.js";

export interface EncryptedValue {
  readonly keyId: string;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export interface Encrypter {
  readonly currentKeyId: string;
  encrypt(plaintext: Uint8Array): Promise<EncryptedValue>;
  decrypt(value: EncryptedValue): Promise<Uint8Array>;
}

const AES_GCM = "AES-GCM";
const IV_BYTES = 12;

/**
 * Reference adapter: AES-256-GCM via WebCrypto (runtime-agnostic — Node ≥ 20,
 * browsers, edge). Keys are raw 32-byte secrets supplied by the composition
 * root from its secret store; KMS-backed adapters implement the same port.
 */
export class WebCryptoAesGcmEncrypter implements Encrypter {
  readonly currentKeyId: string;
  readonly #keys: ReadonlyMap<string, MinimalCryptoKey>;

  private constructor(keys: ReadonlyMap<string, MinimalCryptoKey>, currentKeyId: string) {
    this.#keys = keys;
    this.currentKeyId = currentKeyId;
  }

  static async create(
    rawKeys: ReadonlyMap<string, Uint8Array>,
    currentKeyId: string,
  ): Promise<WebCryptoAesGcmEncrypter> {
    if (!rawKeys.has(currentKeyId)) {
      throw new CryptoFailureError(`current key id "${currentKeyId}" not present in key set`);
    }
    const imported = new Map<string, MinimalCryptoKey>();
    for (const [keyId, raw] of rawKeys) {
      if (raw.byteLength !== 32) {
        throw new CryptoFailureError(`key "${keyId}" must be 32 bytes for AES-256-GCM`);
      }
      imported.set(
        keyId,
        await crypto.subtle.importKey("raw", raw, { name: AES_GCM }, false, ["encrypt", "decrypt"]),
      );
    }
    return new WebCryptoAesGcmEncrypter(imported, currentKeyId);
  }

  async encrypt(plaintext: Uint8Array): Promise<EncryptedValue> {
    const key = this.#keys.get(this.currentKeyId);
    if (key === undefined) {
      throw new CryptoFailureError("current encryption key unavailable");
    }
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt({ name: AES_GCM, iv }, key, plaintext);
    return { keyId: this.currentKeyId, iv, ciphertext: new Uint8Array(ciphertext) };
  }

  async decrypt(value: EncryptedValue): Promise<Uint8Array> {
    const key = this.#keys.get(value.keyId);
    if (key === undefined) {
      throw new CryptoFailureError("unknown encryption key id", {
        metadata: { keyId: value.keyId },
      });
    }
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: AES_GCM, iv: value.iv },
        key,
        value.ciphertext,
      );
      return new Uint8Array(plaintext);
    } catch {
      // Deliberately detail-free: GCM auth failures must not leak specifics.
      throw new CryptoFailureError("decryption failed");
    }
  }
}
