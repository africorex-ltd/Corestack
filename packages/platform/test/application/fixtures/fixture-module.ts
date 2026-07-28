/**
 * A minimal but *real* module factory, used only to prove the
 * `ModuleFactory<TDeps, TConfig, TUseCases>` generic type-checks for a
 * realistic shape (deps drawn from real kernel ports, a config object, and
 * a properly-typed use-case surface) — not just a conformance-checker
 * fixture. Test-only: this is not shipped in the package's production
 * surface (no business meaning belongs in `platform`, same rule as kernel).
 */

import type { Clock, IdGenerator } from "@corestack/kernel";

import type { ModuleFactory } from "../../../src/application/module-lifecycle.js";

export interface FixtureModuleDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface FixtureModuleConfig {
  readonly greeting: string;
}

export interface FixtureUseCases {
  ping(): string;
  now(): Date;
}

export const createFixtureModule: ModuleFactory<
  FixtureModuleDeps,
  FixtureModuleConfig,
  FixtureUseCases
> = (deps, config) => ({
  useCases: {
    ping: () => `${config.greeting} ${deps.ids.generate()}`,
    now: () => deps.clock.now(),
  },
  eventHandlers: [{ consumer: "fixture", event: "*", handler: () => {} }],
  health: () => ({ status: "healthy" }),
});
