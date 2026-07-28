/**
 * Module lifecycle contract (E03-T20; ADR-0014; Architecture §8).
 *
 * Every CoreStack module — first-party or third-party — exports a factory:
 *
 *   createXModule(deps: XDeps, config: XConfig): ModuleInstance<XUseCases>
 *
 * The composition root (T21) calls this factory once per installed module,
 * injecting adapters it already constructed; a module never constructs its
 * own infrastructure. `deps` and `config` are module-specific (each module
 * defines its own shapes); this file defines the one shape every module's
 * *return value* must have, so tooling (composition root, CLI `doctor`,
 * health aggregation) can treat every module — first- or third-party —
 * identically.
 *
 * `checkModuleConformance` exists because TypeScript's structural typing is
 * a compile-time-only guarantee: a third-party module is never compiled
 * against `ModuleInstance` at all, and even a first-party module could
 * accidentally satisfy the type with a `handler` that isn't really callable
 * at runtime (e.g. from a bad `as` cast). The composition root runs this
 * check on every module at boot, so a malformed module fails loudly with a
 * precise, aggregated message instead of failing mysteriously later.
 */

import { ValidationError } from "@corestack/kernel";
import type { EventSubscription } from "@corestack/kernel";

import type { MigrationSet } from "./load-migration-set.js";

export type ModuleHealthStatus = "healthy" | "degraded" | "unhealthy";

export interface ModuleHealth {
  readonly status: ModuleHealthStatus;
  /** Non-sensitive diagnostic detail (never secrets — same rule as logging). */
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * What every module factory returns. `TUseCases` is intentionally opaque at
 * this generic level — the composition root only needs to pass it through
 * to interface bindings, never to inspect its shape; each module's own
 * factory signature narrows it to that module's real use-case object.
 */
export interface ModuleInstance<TUseCases = Record<string, unknown>> {
  readonly useCases: TUseCases;
  readonly eventHandlers: readonly EventSubscription[];
  /** Present only for modules that own a Postgres schema of their own. */
  readonly migrations?: MigrationSet;
  health(): ModuleHealth | Promise<ModuleHealth>;
}

/** The shape every module's exported factory function must have. */
export type ModuleFactory<TDeps, TConfig, TUseCases = Record<string, unknown>> = (
  deps: TDeps,
  config: TConfig,
) => ModuleInstance<TUseCases>;

export interface ModuleConformanceIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Structural, runtime verification of `ModuleInstance`. Returns every issue
 * found — not just the first — matching the aggregate-errors convention
 * used by `loadMigrationSet` and the (upcoming) config validation framework.
 */
export function checkModuleConformance(instance: unknown): ModuleConformanceIssue[] {
  const issues: ModuleConformanceIssue[] = [];

  if (typeof instance !== "object" || instance === null) {
    return [{ path: "$", message: "module instance must be an object" }];
  }
  const mod = instance as Record<string, unknown>;

  if (typeof mod.useCases !== "object" || mod.useCases === null) {
    issues.push({ path: "useCases", message: "must be an object (may be empty {})" });
  }

  if (!Array.isArray(mod.eventHandlers)) {
    issues.push({ path: "eventHandlers", message: "must be an array" });
  } else {
    mod.eventHandlers.forEach((subscription, index) => {
      const prefix = `eventHandlers[${index}]`;
      if (typeof subscription !== "object" || subscription === null) {
        issues.push({ path: prefix, message: "must be an object" });
        return;
      }
      const sub = subscription as Record<string, unknown>;
      if (typeof sub.consumer !== "string" || sub.consumer.length === 0) {
        issues.push({ path: `${prefix}.consumer`, message: "must be a non-empty string" });
      }
      if (typeof sub.event !== "string" || sub.event.length === 0) {
        issues.push({ path: `${prefix}.event`, message: "must be a non-empty string" });
      }
      if (typeof sub.handler !== "function") {
        issues.push({ path: `${prefix}.handler`, message: "must be a function" });
      }
    });
  }

  if (mod.migrations !== undefined) {
    const migrationSet = mod.migrations as Record<string, unknown> | null;
    const valid =
      typeof migrationSet === "object" &&
      migrationSet !== null &&
      typeof migrationSet.module === "string" &&
      Array.isArray(migrationSet.migrations);
    if (!valid) {
      issues.push({
        path: "migrations",
        message: "if present, must be a MigrationSet ({ module, migrations })",
      });
    }
  }

  if (typeof mod.health !== "function") {
    issues.push({ path: "health", message: "must be a function" });
  }

  return issues;
}

/** Throws with every issue aggregated in `metadata.issues` if non-conformant. */
export function assertModuleConformance(
  instance: unknown,
  moduleName: string,
): asserts instance is ModuleInstance {
  const issues = checkModuleConformance(instance);
  if (issues.length > 0) {
    throw new ValidationError(
      `module "${moduleName}" does not conform to the module lifecycle contract`,
      { metadata: { module: moduleName, issues } },
    );
  }
}
