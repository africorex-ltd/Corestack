/**
 * The `Logger` port's contract suite (E04, following E04-T01's framework).
 * Covers what ADR-0022 made normative for every adapter: structured field
 * preservation, level routing, child-context propagation, runtime
 * redaction of `SENSITIVE_LOG_KEYS`, no mutation of caller-supplied field
 * objects, and stable `Error` serialization.
 *
 * A `Logger` has no return value to assert against — every adapter under
 * test must expose a way to *observe* what was logged. The factory
 * therefore returns both the logger and an `entries()` reader; for
 * `NoopLogger`, `entries()` is simply always empty, which still lets every
 * assertion in this suite run (and pass trivially where nothing was
 * captured to violate).
 */
import type { CapturedLogEntry, LogFields, Logger } from "../logger.js";
import { SENSITIVE_LOG_KEYS } from "../logger.js";
import type { SuiteHarness } from "./harness.js";

export interface LoggerContractAdapter {
  readonly logger: Logger;
  /** Every entry captured so far, in order. Adapters that capture nothing (e.g. a no-op) return `[]` always. */
  entries(): readonly CapturedLogEntry[];
}

export interface LoggerContractFactory {
  (): LoggerContractAdapter | Promise<LoggerContractAdapter>;
}

export function defineLoggerContractSuite(
  harness: SuiteHarness,
  factory: LoggerContractFactory,
): void {
  const { describe, it, expect } = harness;

  describe("Logger contract", () => {
    it("each level method routes to a captured entry with that level (or is a documented no-op)", async () => {
      const { logger, entries } = await factory();
      const levels: Array<[keyof Logger, string]> = [
        ["trace", "trace"],
        ["debug", "debug"],
        ["info", "info"],
        ["warn", "warn"],
        ["error", "error"],
        ["fatal", "fatal"],
      ];
      for (const [method, level] of levels) {
        (logger[method] as (message: string, fields?: LogFields) => void)(`msg-${level}`);
      }
      const captured = entries();
      if (captured.length === 0) return; // e.g. NoopLogger: nothing to assert further
      expect(captured.map((e) => e.level)).toEqual(["trace", "debug", "info", "warn", "error", "fatal"]);
      expect(captured.map((e) => e.message)).toEqual([
        "msg-trace",
        "msg-debug",
        "msg-info",
        "msg-warn",
        "msg-error",
        "msg-fatal",
      ]);
    });

    it("structured fields are preserved on the entry", async () => {
      const { logger, entries } = await factory();
      logger.info("hello", { userId: "u1", count: 3 });
      const captured = entries();
      if (captured.length === 0) return;
      expect(captured[0]?.fields).toEqual({ userId: "u1", count: 3 });
    });

    it("child() binds fields onto every subsequent entry (context propagation)", async () => {
      const { logger, entries } = await factory();
      const child = logger.child({ module: "auth", correlationId: "c1" });
      child.info("logged in", { userId: "u1" });
      const captured = entries();
      if (captured.length === 0) return;
      expect(captured[0]?.fields).toEqual({ module: "auth", correlationId: "c1", userId: "u1" });
    });

    it("a grandchild merges every ancestor's bound fields, deepest wins on key collision", async () => {
      const { logger, entries } = await factory();
      const child = logger.child({ module: "auth", scope: "outer" });
      const grandchild = child.child({ scope: "inner", extra: true });
      grandchild.warn("nested");
      const captured = entries();
      if (captured.length === 0) return;
      expect(captured[0]?.fields).toEqual({ module: "auth", scope: "inner", extra: true });
    });

    it("SECURITY: SENSITIVE_LOG_KEYS fields are redacted, never captured in the clear (ADR-0022)", async () => {
      const { logger, entries } = await factory();
      const sensitiveFields: LogFields = {};
      for (const key of SENSITIVE_LOG_KEYS) {
        (sensitiveFields as Record<string, unknown>)[key] = `real-${key}-value`;
      }
      logger.info("request handled", { ...sensitiveFields, userId: "u1" });
      const captured = entries();
      if (captured.length === 0) return;
      const fields = captured[0]?.fields as Record<string, unknown>;
      expect(fields.userId).toBe("u1");
      for (const key of SENSITIVE_LOG_KEYS) {
        expect(fields[key]).not.toBe(`real-${key}-value`);
      }
    });

    it("SECURITY: a sensitive key bound via child() is still redacted at emission", async () => {
      const { logger, entries } = await factory();
      const child = logger.child({ password: "hunter2" });
      child.info("oops");
      const captured = entries();
      if (captured.length === 0) return;
      const fields = captured[0]?.fields as Record<string, unknown>;
      expect(fields.password).not.toBe("hunter2");
    });

    it("logging an Error value preserves name/message/stack, never silently loses it to an empty object", async () => {
      const { logger, entries } = await factory();
      const err = new Error("boom");
      logger.error("failed", { err });
      const captured = entries();
      if (captured.length === 0) return;
      const fields = captured[0]?.fields as Record<string, unknown>;
      expect(fields.err).not.toEqual({});
      expect((fields.err as { message?: string }).message).toBe("boom");
      expect((fields.err as { name?: string }).name).toBe("Error");
      expect(typeof (fields.err as { stack?: string }).stack).toBe("string");
    });

    it("does not mutate the caller's fields object", async () => {
      const { logger } = await factory();
      const fields: LogFields = Object.freeze({ userId: "u1" });
      expect(() => logger.info("x", fields)).not.toThrow();
      expect(fields).toEqual({ userId: "u1" });
    });
  });
}
