/**
 * The `Logger` port (Architecture §30).
 *
 * Modules log through this port exclusively — never `console` (lint-enforced).
 * Contract for adapters: structured JSON output, inclusion of child-bound
 * context fields on every line, and **runtime redaction** of
 * `SENSITIVE_LOG_KEYS` fields via `redactSensitiveFields` — defense-in-depth
 * behind the static eslint deny-list, which only catches literal field names
 * at the call site, not fields assigned via a dynamic key. `Error` values
 * must be passed through `serializeErrorForLog` first (a plain `{...error}`
 * spread silently loses `message`/`stack`, which are non-enumerable). The
 * kernel ships a no-op default and a capturing test logger, both applying
 * this contract; the pino reference adapter arrives with the platform
 * package and must apply it too.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  fatal(message: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line (module, correlationId, orgId…). */
  child(fields: LogFields): Logger;
}

/**
 * Keys adapters MUST redact if they ever appear in log fields. Single source
 * shared (by convention) with the eslint sensitive-log deny-list — extend
 * both together.
 */
export const SENSITIVE_LOG_KEYS: readonly string[] = [
  "password",
  "passwordHash",
  "passwd",
  "secret",
  "clientSecret",
  "token",
  "rawToken",
  "accessToken",
  "refreshToken",
  "apiKey",
  "authorization",
  "credential",
  "credentials",
  "cookie",
  "setCookie",
];

const REDACTED = "[REDACTED]";

/**
 * `Error`'s own `message`/`stack` properties are non-enumerable, so a plain
 * `{...error}` spread (or `JSON.stringify`) silently produces `{}` — every
 * detail lost. Every `Logger` adapter must call this before storing/emitting
 * a field whose value is an `Error`, so a caller logging `{ err }` gets a
 * stable, complete record rather than an empty object.
 */
export function serializeErrorForLog(error: Error): Readonly<Record<string, unknown>> {
  const { name, message, stack, ...rest } = error as Error & Record<string, unknown>;
  return Object.freeze({ name, message, stack, ...rest });
}

/**
 * Redacts `SENSITIVE_LOG_KEYS` fields and stably serializes `Error` values.
 * This is defense-in-depth behind the static eslint deny-list (which only
 * catches literal field names at the call site, not fields assigned via a
 * dynamic key) — every `Logger` adapter must apply this to its final,
 * merged field set before storing/emitting it. Never mutates `fields`.
 */
export function redactSensitiveFields(fields: LogFields): LogFields {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_LOG_KEYS.includes(key)) {
      result[key] = REDACTED;
    } else if (value instanceof Error) {
      result[key] = serializeErrorForLog(value);
    } else {
      result[key] = value;
    }
  }
  return Object.freeze(result);
}

export class NoopLogger implements Logger {
  trace(_message: string, _fields?: LogFields): void {}
  debug(_message: string, _fields?: LogFields): void {}
  info(_message: string, _fields?: LogFields): void {}
  warn(_message: string, _fields?: LogFields): void {}
  error(_message: string, _fields?: LogFields): void {}
  fatal(_message: string, _fields?: LogFields): void {}
  child(_fields: LogFields): Logger {
    return this;
  }
}

export interface CapturedLogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: LogFields;
}

/**
 * Test adapter: records entries (with child fields merged) for assertions.
 * Children share their parent's `entries` sink by construction (AUD-09).
 */
export class CaptureLogger implements Logger {
  readonly entries: CapturedLogEntry[];
  readonly #bound: LogFields;

  constructor(bound: LogFields = {}, sink: CapturedLogEntry[] = []) {
    this.#bound = bound;
    this.entries = sink;
  }

  #log(level: LogLevel, message: string, fields: LogFields = {}): void {
    this.entries.push({
      level,
      message,
      fields: redactSensitiveFields({ ...this.#bound, ...fields }),
    });
  }

  trace(message: string, fields?: LogFields): void {
    this.#log("trace", message, fields);
  }
  debug(message: string, fields?: LogFields): void {
    this.#log("debug", message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.#log("info", message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.#log("warn", message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.#log("error", message, fields);
  }
  fatal(message: string, fields?: LogFields): void {
    this.#log("fatal", message, fields);
  }

  child(fields: LogFields): Logger {
    return new CaptureLogger({ ...this.#bound, ...fields }, this.entries);
  }
}
