/**
 * `createCoreStack()` — the composition helper (E03-T21; ADR-0014).
 *
 * Design note: [docs/create-core-stack-design-note.md](../../docs/create-core-stack-design-note.md).
 * In short — this function does **not** construct modules; the adopter's
 * own composition script calls each module's factory directly, explicitly,
 * with no reflection. `createCoreStack()` receives the already-built
 * `ModuleInstance`s and performs only the cross-cutting wiring that
 * genuinely needs one place to happen: conformance-checking, event-bus
 * subscription, boot-time collision detection, and health aggregation.
 */

import { ValidationError, type EventBus } from "@corestack/kernel";

import {
  checkModuleConformance,
  type ModuleConformanceIssue,
  type ModuleHealth,
  type ModuleHealthStatus,
  type ModuleInstance,
} from "./module-lifecycle.js";

export interface CreateCoreStackOptions {
  /** The single `EventBus` instance every module's deps were built with. */
  readonly eventBus: EventBus;
  /** Already-constructed module instances, keyed by the module's name. */
  readonly modules: Readonly<Record<string, ModuleInstance>>;
}

export interface CoreStackHealth {
  readonly status: ModuleHealthStatus;
  readonly modules: Readonly<Record<string, ModuleHealth>>;
}

export interface CoreStack {
  readonly modules: Readonly<Record<string, ModuleInstance>>;
  /** Worst-of aggregation across every module's `health()`. */
  health(): Promise<CoreStackHealth>;
}

function worstStatus(statuses: readonly ModuleHealthStatus[]): ModuleHealthStatus {
  if (statuses.includes("unhealthy")) return "unhealthy";
  if (statuses.includes("degraded")) return "degraded";
  return "healthy";
}

/** Boot-time checks beyond per-module conformance: cross-module mistakes. */
function checkCompositionIssues(
  modules: Readonly<Record<string, ModuleInstance>>,
): ModuleConformanceIssue[] {
  const issues: ModuleConformanceIssue[] = [];
  const seenConsumerEventPairs = new Map<string, string>(); // "consumer|event" -> owning module

  for (const [name, instance] of Object.entries(modules)) {
    for (const subscription of instance.eventHandlers) {
      const key = `${subscription.consumer}|${subscription.event}`;
      const owner = seenConsumerEventPairs.get(key);
      if (owner !== undefined) {
        issues.push({
          path: `${name}.eventHandlers`,
          message:
            `duplicate (consumer, event) registration "${subscription.consumer}" / "${subscription.event}" — ` +
            `already registered by module "${owner}"; this would corrupt outbox checkpoint tracking`,
        });
      } else {
        seenConsumerEventPairs.set(key, name);
      }
    }

    if (instance.migrations !== undefined && instance.migrations.module !== name) {
      issues.push({
        path: `${name}.migrations`,
        message:
          `migration set declares module "${instance.migrations.module}" but was registered under key "${name}" — ` +
          `likely a copy-paste mistake in composition`,
      });
    }
  }

  return issues;
}

/**
 * Wire already-constructed module instances into one `CoreStack`. Throws
 * `ValidationError` with every issue aggregated (per-module conformance
 * problems, namespaced by module name, plus cross-module composition
 * issues) if anything is wrong — boot-fails loudly and precisely rather
 * than succeeding into a broken runtime state.
 */
export function createCoreStack(options: CreateCoreStackOptions): CoreStack {
  const conformanceIssues: ModuleConformanceIssue[] = [];

  for (const [name, instance] of Object.entries(options.modules)) {
    for (const issue of checkModuleConformance(instance)) {
      conformanceIssues.push({ path: `${name}.${issue.path}`, message: issue.message });
    }
  }

  // Composition-level checks (below) assume every instance is already
  // structurally well-formed (e.g. `eventHandlers` is iterable) — running
  // them against a malformed instance would crash with a raw TypeError
  // instead of the aggregated ValidationError this function promises. Only
  // run them once conformance has fully passed.
  const issues =
    conformanceIssues.length > 0
      ? conformanceIssues
      : [...conformanceIssues, ...checkCompositionIssues(options.modules)];

  if (issues.length > 0) {
    throw new ValidationError(
      `composition failed: ${issues.length} issue(s) across ${Object.keys(options.modules).length} module(s)`,
      { metadata: { issues } },
    );
  }

  for (const instance of Object.values(options.modules)) {
    for (const subscription of instance.eventHandlers) {
      options.eventBus.subscribe(subscription);
    }
  }

  return {
    modules: options.modules,
    async health(): Promise<CoreStackHealth> {
      const entries = await Promise.all(
        Object.entries(options.modules).map(
          async ([name, instance]) => [name, await instance.health()] as const,
        ),
      );
      const moduleHealth = Object.fromEntries(entries);
      return {
        status: worstStatus(entries.map(([, health]) => health.status)),
        modules: moduleHealth,
      };
    },
  };
}
