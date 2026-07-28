/**
 * In-memory `EnvSource` test double (E03-T22) — lets config-validation
 * tests (and adopter tests of their own module config) run without
 * touching real process environment variables.
 */

import type { EnvSource } from "../application/config-validation.js";

export class InMemoryEnvSource implements EnvSource {
  readonly #values: ReadonlyMap<string, string>;

  constructor(values: Readonly<Record<string, string>> = {}) {
    this.#values = new Map(Object.entries(values));
  }

  get(key: string): string | undefined {
    return this.#values.get(key);
  }
}
