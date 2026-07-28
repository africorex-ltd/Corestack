/**
 * `ProcessEnvSource` — the reference `EnvSource` adapter (E03-T22).
 * Thin wrapper over `process.env`; the only place this framework touches
 * a Node global, kept in the infrastructure layer where that's allowed.
 */

import type { EnvSource } from "../application/config-validation.js";

export class ProcessEnvSource implements EnvSource {
  get(key: string): string | undefined {
    return process.env[key];
  }
}
