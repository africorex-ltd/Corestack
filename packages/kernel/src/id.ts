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

/**
 * Production adapter: **UUID v7** (DB design rule 2) — time-ordered ids keep
 * B-tree inserts append-mostly, unlike random v4. Monotonic within this
 * process: the 12-bit rand_a field is used as a sequence counter within a
 * millisecond, so ids sort by generation order. Uses WebCrypto randomness —
 * no Node builtins (ADR-0001); as an *adapter* it may read wall-clock time
 * directly.
 */
export class UuidGenerator implements IdGenerator {
  #lastMs = -1;
  #seq = 0;

  generate(): string {
    let ms = Date.now();
    if (ms <= this.#lastMs) {
      // Clock stalled or went backwards: keep ordering by advancing the
      // sequence (and borrowing a millisecond on overflow).
      ms = this.#lastMs;
      this.#seq += 1;
      if (this.#seq > 0xfff) {
        ms += 1;
        this.#lastMs = ms;
        this.#seq = 0;
      }
    } else {
      this.#lastMs = ms;
      this.#seq = 0;
    }

    const bytes = new Uint8Array(16);
    // 48-bit big-endian unix milliseconds.
    bytes[0] = (ms / 2 ** 40) & 0xff;
    bytes[1] = (ms / 2 ** 32) & 0xff;
    bytes[2] = (ms / 2 ** 24) & 0xff;
    bytes[3] = (ms / 2 ** 16) & 0xff;
    bytes[4] = (ms / 2 ** 8) & 0xff;
    bytes[5] = ms & 0xff;
    // Version 7 + 12-bit sequence (rand_a).
    bytes[6] = 0x70 | ((this.#seq >> 8) & 0x0f);
    bytes[7] = this.#seq & 0xff;
    // Variant bits + 62 random bits (rand_b).
    const random = crypto.getRandomValues(new Uint8Array(8));
    bytes[8] = 0x80 | ((random[0] as number) & 0x3f);
    for (let i = 1; i < 8; i++) {
      bytes[8 + i] = random[i] as number;
    }

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
