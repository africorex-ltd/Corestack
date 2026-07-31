import { registerPurgeHandler } from "@corestack/platform";
import type { MigrationSet, ModuleHealth, ModuleInstance } from "@corestack/platform";
import type { ProcessedEventStore } from "@corestack/kernel";

import type { TenancyConfig } from "./config.js";
import type { OrganizationRepository } from "./organization-repository.js";
import type { MembershipRepository } from "./membership-repository.js";
import type { InvitationRepository } from "./invitation-repository.js";

/**
 * `createTenancyModule`'s dependencies. Repository ports are already
 * injected here (Section 7), even though nothing calls them yet — Section
 * 13's adopted policy is "repositories before persistence," and a module
 * factory that only wires deps once real use cases exist would relitigate
 * this shape at every future task instead of settling it now.
 */
export interface TenancyModuleDeps {
  readonly processedEventStore: ProcessedEventStore;
  /** Pre-loaded via `loadMigrationSet` + `FsMigrationSource` at composition time. */
  readonly migrations: MigrationSet;
  readonly organizationRepository: OrganizationRepository;
  readonly membershipRepository: MembershipRepository;
  readonly invitationRepository: InvitationRepository;
}

/**
 * No use cases exist yet (E05-T07 onward). An empty object, not
 * `Record<string, unknown>`, so a future command added here is a type
 * change callers must acknowledge, not a silent widening.
 */
export type TenancyUseCases = Record<string, never>;

/**
 * The module scaffold itself (E05-T01's deliverable). Every step of
 * Section 13's adopted policy applied to one factory: lifecycle-first
 * registration, health before runtime, purge before data.
 */
export function createTenancyModule(
  deps: TenancyModuleDeps,
  config: TenancyConfig,
): ModuleInstance<TenancyUseCases> {
  // Accepted now, unused until the first real command (E05-T07) reads
  // them — declaring the dependency shape before the behavior exists is
  // the point (Section 13, "contract before implementation").
  void config;
  void deps.organizationRepository;
  void deps.membershipRepository;
  void deps.invitationRepository;

  // Registered now, on purpose, even though Tenancy owns no purgeable data
  // yet: a purge handler that silently no-ops would let the purge protocol
  // mark Tenancy's purge "completed" while deleting nothing once real data
  // exists later — worse than not registering at all. Throwing keeps the
  // gap loud until a future task implements the real delete. (E05-T13
  // turned out to be the HTTP interface layer, not purge logic — this
  // comment originally guessed T13 for the real delete; not yet
  // resequenced by the founder directive.)
  const purgeSubscription = registerPurgeHandler(
    "tenancy",
    async () => {
      throw new Error(
        "tenancy purge handler is not implemented yet (scaffold-only, E05-T01); " +
          "real deletion logic ships in a future task",
      );
    },
    deps.processedEventStore,
  );

  return {
    useCases: {},
    eventHandlers: [purgeSubscription],
    migrations: deps.migrations,
    health(): ModuleHealth {
      // Real signals (tenancy-schema reachability, pending_deletion sweep
      // backlog) are an open question the contract doc defers to this
      // task — left as a static "healthy" stub rather than inventing
      // checks with no corresponding data yet to check against. Matches
      // `acme-crm-module`'s own precedent for the same reason.
      return { status: "healthy" };
    },
  };
}
