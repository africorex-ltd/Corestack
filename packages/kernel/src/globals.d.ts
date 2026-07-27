// Minimal ambient WebCrypto surface. The kernel compiles against the pure
// ES2022 lib — no Node or DOM type libs (ADR-0001) — so the WebCrypto global
// (present at runtime in Node ≥ 20, browsers, and edge runtimes) is declared
// here with exactly the members the kernel uses, nothing more. This file is
// not part of the emitted package types; consumers resolve `crypto` from
// their own runtime typings.

interface MinimalCryptoKey {
  readonly type: string;
}

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}

declare const crypto: {
  randomUUID(): string;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  subtle: {
    importKey(
      format: "raw",
      keyData: Uint8Array,
      algorithm: { name: string },
      extractable: boolean,
      keyUsages: readonly string[],
    ): Promise<MinimalCryptoKey>;
    encrypt(
      algorithm: { name: string; iv: Uint8Array },
      key: MinimalCryptoKey,
      data: Uint8Array,
    ): Promise<ArrayBuffer>;
    decrypt(
      algorithm: { name: string; iv: Uint8Array },
      key: MinimalCryptoKey,
      data: Uint8Array,
    ): Promise<ArrayBuffer>;
  };
};
