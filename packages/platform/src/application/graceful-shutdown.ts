/**
 * Graceful shutdown orchestration (E03-T24; Architecture §36).
 *
 * On SIGTERM (or any shutdown trigger): stop accepting new work first,
 * then drain registered components **in registration order**, each
 * bounded by its own timeout so one stuck component cannot hang the whole
 * process forever. This is generic orchestration over a small
 * `Drainable` port — it knows nothing about HTTP listeners, outbox
 * relays, or job queues specifically; those register as drainables when
 * they exist (T12+).
 */

import type { Logger } from "@corestack/kernel";

export interface Drainable {
  /** A short, log-friendly name (e.g. "http-listener", "outbox-relay"). */
  readonly name: string;
  /** Stop accepting new work; must resolve once draining can begin. */
  stopIntake(): Promise<void>;
  /** Finish in-flight work and release resources. */
  drain(): Promise<void>;
}

export interface GracefulShutdownOptions {
  /** Drained in this exact order — earlier entries finish before later ones start. */
  readonly drainables: readonly Drainable[];
  /** Upper bound on each drainable's `drain()`; exceeding it is a timeout, not a crash. */
  readonly drainTimeoutMs: number;
  readonly logger?: Logger;
}

export type ShutdownOutcome =
  | { readonly name: string; readonly outcome: "drained" }
  | { readonly name: string; readonly outcome: "timed_out" }
  | { readonly name: string; readonly outcome: "failed"; readonly error: unknown };

export interface ShutdownReport {
  readonly outcomes: readonly ShutdownOutcome[];
  /** True only if every drainable finished cleanly within its timeout. */
  readonly clean: boolean;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Runs the full stop-intake → drain sequence, in order, bounded by
 * timeout. **Never throws** — every failure or timeout is captured in the
 * returned report, because a shutdown routine that itself crashes defeats
 * the purpose of a graceful shutdown.
 */
export async function shutdownGracefully(
  options: GracefulShutdownOptions,
): Promise<ShutdownReport> {
  const logger = options.logger;

  // Stop-intake phase: every drainable stops accepting new work before any
  // draining begins, so nothing new arrives mid-drain. Intake-stop failures
  // are logged but never block draining — refusing to shut down because one
  // listener failed to unbind would be worse than proceeding.
  for (const drainable of options.drainables) {
    try {
      await drainable.stopIntake();
    } catch (error) {
      logger?.warn(`shutdown: stopIntake failed for "${drainable.name}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const outcomes: ShutdownOutcome[] = [];
  for (const drainable of options.drainables) {
    try {
      await withTimeout(drainable.drain(), options.drainTimeoutMs);
      outcomes.push({ name: drainable.name, outcome: "drained" });
      logger?.info(`shutdown: "${drainable.name}" drained cleanly`);
    } catch (error) {
      if (error instanceof Error && error.message === "timeout") {
        outcomes.push({ name: drainable.name, outcome: "timed_out" });
        logger?.warn(`shutdown: "${drainable.name}" timed out after ${options.drainTimeoutMs}ms`);
      } else {
        outcomes.push({ name: drainable.name, outcome: "failed", error });
        logger?.warn(`shutdown: "${drainable.name}" failed to drain`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { outcomes, clean: outcomes.every((o) => o.outcome === "drained") };
}
