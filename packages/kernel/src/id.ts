/**
 * Port for the ambient effect of identifier generation.
 *
 * Entities receive their ids from an `IdGenerator` rather than generating them
 * inline, keeping domain code deterministic under test and letting adopters
 * choose their id scheme (UUIDs, ULIDs, prefixed ids) platform-wide.
 */

export interface IdGenerator {
  generate(): string;
}

// The kernel compiles against the pure ES2022 lib (no Node or DOM type libs) to
// guarantee runtime-agnosticism, so the WebCrypto global — present at runtime in
// Node ≥ 20, browsers, and edge runtimes — is declared minimally here.
declare const crypto: { randomUUID(): string };

/**
 * Production adapter: UUID v4 via the WebCrypto API (available in Node ≥ 20,
 * browsers, and edge runtimes — no Node builtin import required).
 */
export class UuidGenerator implements IdGenerator {
  generate(): string {
    return crypto.randomUUID();
  }
}

/** Test adapter: hands out predetermined ids in order. */
export class SequentialIdGenerator implements IdGenerator {
  #next = 0;

  constructor(private readonly prefix = "id-") {}

  generate(): string {
    this.#next += 1;
    return `${this.prefix}${this.#next}`;
  }
}
