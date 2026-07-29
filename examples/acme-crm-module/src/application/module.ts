import {
  idempotentHandler,
  type Clock,
  type EventSubscription,
  type IdGenerator,
  type ProcessedEventStore,
  type Result,
  type ValidationError,
} from "@corestack/kernel";
import {
  registerPurgeHandler,
  requireOrgScoped,
  type MigrationSet,
  type ModuleHealth,
  type ModuleInstance,
  type OrgScopedContext,
} from "@corestack/platform";
import { PostgresUnitOfWork, withOrgContext } from "@corestack/platform/postgres";
import type { Sql } from "postgres";

import type { Contact, CreateContactInput } from "../domain/contact.js";
import type { ContactRepository } from "./contact-repository.js";
import { CONTACT_CREATED_EVENT, createContact } from "./create-contact.js";
import type { AcmeCrmConfig } from "./config.js";

const WELCOME_CONSUMER = "acme-crm:contact-created-welcome";

export interface AcmeCrmModuleDeps {
  readonly sql: Sql;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly processedEventStore: ProcessedEventStore;
  /** Pre-loaded via `loadMigrationSet` + `FsMigrationSource` at composition time (ModuleFactory itself is synchronous). */
  readonly migrations: MigrationSet;
  /**
   * Constructed by the composition script (e.g. `new
   * PostgresContactRepository()`), never by this module's own application
   * layer — the application layer may not import `infrastructure/`
   * directly (Clean Architecture's dependency rule, enforced here by the
   * same ESLint zone rule as every platform package:
   * `tooling/eslint/index.mjs`'s `examples/*\/src/application/**` zone).
   * This file tried the shortcut once (`deps.repository ?? new
   * PostgresContactRepository()`) while building this example — caught
   * immediately by that lint rule once it was extended to cover
   * `examples/*`, which is exactly the point of a golden-path module
   * being linted as strictly as shipped platform code.
   */
  readonly repository: ContactRepository;
}

export interface AcmeCrmUseCases {
  createContact(
    context: OrgScopedContext,
    input: CreateContactInput,
  ): Promise<Result<Contact, ValidationError>>;
  listContacts(context: OrgScopedContext): Promise<readonly Contact[]>;
}

/**
 * The ModuleFactory — every step of
 * docs/security/how-to-build-a-tenant-safe-feature.md wired together in
 * one place. Never constructs its own infrastructure: `deps.sql` is
 * injected by the composition script, matching `createCoreStack`'s
 * "explicit, no reflection" design.
 */
export function createAcmeCrmModule(
  deps: AcmeCrmModuleDeps,
  config: AcmeCrmConfig,
): ModuleInstance<AcmeCrmUseCases> {
  const repository = deps.repository;

  const useCases: AcmeCrmUseCases = {
    async createContact(context, input) {
      return createContact(requireOrgScoped(context), input, {
        uow: new PostgresUnitOfWork(deps.sql, context.organizationId),
        repository,
        ids: deps.ids,
        clock: deps.clock,
      });
    },
    async listContacts(context) {
      return repository.list(deps.sql, requireOrgScoped(context));
    },
  };

  // Step 6: idempotent consumer, extracting organizationId from the event
  // envelope before doing anything tenant-scoped — never trusting a
  // payload field for it (the purge protocol's own established pattern).
  const welcomeSubscription: EventSubscription = {
    consumer: WELCOME_CONSUMER,
    event: CONTACT_CREATED_EVENT,
    handler: idempotentHandler(WELCOME_CONSUMER, deps.processedEventStore, async (event) => {
      if (event.organizationId === null) return; // platform-scoped event; nothing to welcome
      const payload = event.payload as { contactId: string };
      await withOrgContext(deps.sql, event.organizationId, async (tx) => {
        await tx`
          INSERT INTO acme_crm.welcome_log (contact_id, organization_id)
          VALUES (${payload.contactId}::uuid, ${event.organizationId}::uuid)
          ON CONFLICT (contact_id) DO NOTHING
        `;
      });
      // A real module would send an email here, using config.welcomeMessage.
      void config.welcomeMessage;
    }),
  };

  // Step 6 (purge-protocol variant): registerPurgeHandler itself throws if
  // the event carries no organizationId, before this handler ever runs —
  // deletion runs as the app role scoped to the purged org, not an
  // escalated role (see the migration's own comment on this).
  const purgeSubscription = registerPurgeHandler(
    "acme-crm",
    async (organizationId) => {
      await withOrgContext(deps.sql, organizationId, async (tx) => {
        await tx`DELETE FROM acme_crm.welcome_log`;
        await tx`DELETE FROM acme_crm.contacts`;
      });
    },
    deps.processedEventStore,
  );

  return {
    useCases,
    eventHandlers: [welcomeSubscription, purgeSubscription],
    migrations: deps.migrations,
    health(): ModuleHealth {
      return { status: "healthy" };
    },
  };
}
