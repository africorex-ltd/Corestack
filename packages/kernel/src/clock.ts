/**
 * Port for the ambient effect of "what time is it".
 *
 * Domain and application code must never call `Date.now()` directly — they take
 * a `Clock`, which makes time-dependent logic (expiries, scheduling, audit
 * timestamps) deterministic under test.
 */

export interface Clock {
  now(): Date;
}

/** Production adapter: the real system clock. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Test adapter: a controllable clock. */
export class FixedClock implements Clock {
  #current: Date;

  constructor(start: Date) {
    this.#current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.#current.getTime());
  }

  set(to: Date): void {
    this.#current = new Date(to.getTime());
  }

  advance(milliseconds: number): void {
    this.#current = new Date(this.#current.getTime() + milliseconds);
  }
}
