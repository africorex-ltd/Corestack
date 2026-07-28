// Minimal ambient WebCrypto surface for the migration checksum. Platform's
// domain layer compiles against the pure ES2022 lib (no DOM, no Node
// builtins — ADR-0001), so `TextEncoder` and `crypto.subtle.digest` —
// present at runtime in Node >= 20, browsers, and edge runtimes — are
// declared here with exactly the members used, nothing more (mirrors the
// kernel's own `globals.d.ts` pattern).

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare const crypto: {
  subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  };
};
