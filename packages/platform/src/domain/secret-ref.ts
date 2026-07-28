/**
 * Secret-reference syntax (E03-T22; Architecture §8: "secrets by reference").
 *
 * A config value may be a literal, or — for fields explicitly declared
 * `secret: true` — a *reference* the config framework resolves indirectly
 * via a `SecretResolver` (application layer) rather than reading a raw
 * secret straight out of an env var. Syntax: `ref:<opaque-locator>`, e.g.
 * `ref:vault:secret/data/auth#sessionSecret`. Pure string logic — no I/O,
 * no Node builtins.
 */

export const SECRET_REF_PREFIX = "ref:";

export function isSecretRefValue(value: string): boolean {
  return value.startsWith(SECRET_REF_PREFIX);
}

export function stripSecretRefPrefix(value: string): string {
  return value.slice(SECRET_REF_PREFIX.length);
}
