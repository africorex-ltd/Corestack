/**
 * In-memory `SecretResolver` test double (E03-T22) — resolves `ref:...`
 * values from a fixed map, with an optional failure mode for testing the
 * resolution-error path.
 */

import { NotFoundError } from "@corestack/kernel";

import type { SecretResolver } from "../application/config-validation.js";

export class InMemorySecretResolver implements SecretResolver {
  readonly #secrets: ReadonlyMap<string, string>;

  constructor(secrets: Readonly<Record<string, string>> = {}) {
    this.#secrets = new Map(Object.entries(secrets));
  }

  async resolve(ref: string): Promise<string> {
    const value = this.#secrets.get(ref);
    if (value === undefined) {
      throw new NotFoundError(`no secret registered for reference "${ref}"`);
    }
    return value;
  }
}
