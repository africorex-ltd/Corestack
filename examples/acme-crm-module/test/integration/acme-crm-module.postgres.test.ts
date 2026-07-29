/**
 * End-to-end proof of every tenant-isolation touchpoint this module wires
 * together, against real PostgreSQL 18 — not mocked, not run as a
 * superuser (a superuser bypasses RLS entirely, so proving isolation
 * requires a genuinely authenticated app-role connection, matching E03-T31's
 * own harness).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import {
  createContext,
  FixedClock,
  InMemoryProcessedEventStore,
  isOk,
  UuidGenerator,
  type DomainEvent,
} from "@corestack/kernel";
import {
  FsMigrationSource,
  loadMigrationSet,
  OutboxRelay,
  requireOrgScoped,
  runMigrations,
  type MigrationSet,
  type OrgScopedContext,
} from "@corestack/platform";
import {
  ensureMigrationTrackingSchema,
  ensureOutboxSchema,
  PostgresMigrationRunnerStore,
  PostgresOutboxRelayStore,
} from "@corestack/platform/postgres";

import { createAcmeCrmModule, type AcmeCrmUseCases } from "../../src/application/module.js";
import {
  ACME_CRM_APP_ROLE,
  ensureAcmeCrmRoles,
} from "../../src/infrastructure/ensure-acme-crm-roles.js";
import { PostgresContactRepository } from "../../src/infrastructure/postgres-contact-repository.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL === undefined) {
  throw new Error(
    "DATABASE_URL is required for this integration test (a local PostgreSQL 18 instance)",
  );
}

const APP_ROLE_PASSWORD = "test-only-scratch-db-password";
const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

let admin: Sql;
let dbName: string;
let superuserSql: Sql;
let appRoleSql: Sql;
let migrations: MigrationSet;
const ids = new UuidGenerator();
const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));

beforeAll(async () => {
  admin = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  dbName = `acme_crm_example_${Date.now()}`;
  await admin.unsafe(`CREATE DATABASE ${dbName}`);

  const url = new URL(DATABASE_URL);
  url.pathname = `/${dbName}`;
  superuserSql = postgres(url.toString(), { max: 5, onnotice: () => {} });

  await ensureMigrationTrackingSchema(superuserSql);
  await ensureOutboxSchema(superuserSql, { referenceDate: clock.now() });
  await ensureAcmeCrmRoles(superuserSql);

  const migrationSetResult = await loadMigrationSet(
    "acme-crm",
    new FsMigrationSource({ baseDir: MIGRATIONS_DIR }),
  );
  if (!isOk(migrationSetResult)) {
    throw new Error(`failed to load acme-crm migrations: ${migrationSetResult.error.message}`);
  }
  migrations = migrationSetResult.value;

  const runResult = await runMigrations(migrations, new PostgresMigrationRunnerStore(superuserSql));
  if (!isOk(runResult)) {
    throw new Error(`failed to apply acme-crm migrations: ${runResult.error.message}`);
  }

  // Test-only: grant a login password so this test can connect directly as
  // the app role, exactly matching E03-T31's own harness (real production
  // credentials remain an unresolved deployment decision — Residual Risk
  // R3 in docs/security/tenant-isolation-certification.md).
  await superuserSql.unsafe(
    `ALTER ROLE ${ACME_CRM_APP_ROLE} LOGIN PASSWORD '${APP_ROLE_PASSWORD}'`,
  );
  const appRoleUrl = new URL(url.toString());
  appRoleUrl.username = ACME_CRM_APP_ROLE;
  appRoleUrl.password = APP_ROLE_PASSWORD;
  appRoleSql = postgres(appRoleUrl.toString(), { max: 5, onnotice: () => {} });
}, 120_000);

afterAll(async () => {
  await appRoleSql?.end({ timeout: 5 });
  await superuserSql?.end({ timeout: 5 });
  if (admin !== undefined && dbName !== undefined) {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  }
  await admin?.end();
});

beforeEach(async () => {
  await superuserSql`DELETE FROM acme_crm.welcome_log`;
  await superuserSql`DELETE FROM acme_crm.contacts`;
  await superuserSql`DELETE FROM platform.processed_events`;
  await superuserSql`DELETE FROM platform.outbox`;
  await superuserSql`DELETE FROM platform.outbox_checkpoints`;
});

function contextFor(organizationId: string): OrgScopedContext {
  const actorId = "33333333-3333-3333-3333-333333333333";
  return requireOrgScoped(
    createContext({ actor: { type: "user", id: actorId }, organizationId }, ids),
  );
}

function buildModule(): {
  useCases: AcmeCrmUseCases;
  eventHandlers: ReturnType<typeof createAcmeCrmModule>["eventHandlers"];
} {
  const acmeCrm = createAcmeCrmModule(
    {
      sql: appRoleSql,
      ids,
      clock,
      processedEventStore: new InMemoryProcessedEventStore(),
      migrations,
      repository: new PostgresContactRepository(),
    },
    { welcomeMessage: "Welcome to Acme CRM!" },
  );
  return { useCases: acmeCrm.useCases, eventHandlers: acmeCrm.eventHandlers };
}

function purgeEvent(organizationId: string): DomainEvent {
  const context = createContext({ actor: { type: "system", id: null }, organizationId }, ids);
  return {
    id: ids.generate(),
    name: "organization.purge_requested",
    version: 1,
    occurredAt: clock.now(),
    organizationId,
    actor: context.actor,
    correlationId: context.correlationId,
    causationId: null,
    payload: {},
  };
}

describe("acme-crm-module golden path (E03 Tenant Isolation Certification example)", () => {
  it("creates a contact for org A, and org B's listContacts never sees it (RLS both directions)", async () => {
    const { useCases } = buildModule();

    const created = await useCases.createContact(contextFor(ORG_A), {
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(created.ok).toBe(true);

    const orgAContacts = await useCases.listContacts(contextFor(ORG_A));
    expect(orgAContacts.map((c) => c.email)).toEqual(["ada@example.com"]);

    const orgBContacts = await useCases.listContacts(contextFor(ORG_B));
    expect(orgBContacts).toEqual([]);
  });

  it("commits the contact and the contact-created event atomically (UnitOfWork)", async () => {
    const { useCases } = buildModule();

    const created = await useCases.createContact(contextFor(ORG_A), {
      name: "Grace Hopper",
      email: "grace@example.com",
    });
    expect(created.ok).toBe(true);

    const outboxRows = await superuserSql`
      SELECT id FROM platform.outbox WHERE event_name = 'acmecrm.contact.created'
    `;
    expect(outboxRows).toHaveLength(1);
  });

  it("the idempotent welcome consumer fires exactly once across relay redelivery", async () => {
    const { useCases, eventHandlers } = buildModule();

    const created = await useCases.createContact(contextFor(ORG_A), {
      name: "Katherine Johnson",
      email: "katherine@example.com",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const relay = new OutboxRelay({
      store: new PostgresOutboxRelayStore(superuserSql),
      subscriptions: eventHandlers,
      pollIntervalMs: 1000,
    });

    await relay.pollOnce();
    await relay.pollOnce(); // redelivery attempt — must be a no-op

    const welcomeRows = await superuserSql`
      SELECT contact_id FROM acme_crm.welcome_log WHERE contact_id = ${created.value.id}::uuid
    `;
    expect(welcomeRows).toHaveLength(1);
  });

  it("the purge handler deletes only the purged org's contacts, via the app role's own RLS scope", async () => {
    const { useCases, eventHandlers } = buildModule();

    await useCases.createContact(contextFor(ORG_A), {
      name: "Org A Contact",
      email: "a@example.com",
    });
    await useCases.createContact(contextFor(ORG_B), {
      name: "Org B Contact",
      email: "b@example.com",
    });

    const purgeSubscription = eventHandlers.find((s) => s.event === "organization.purge_requested");
    if (purgeSubscription === undefined) throw new Error("purge subscription not registered");

    await purgeSubscription.handler(purgeEvent(ORG_A));

    const remaining = await superuserSql<{ organization_id: string }[]>`
      SELECT organization_id FROM acme_crm.contacts
    `;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.organization_id).toBe(ORG_B);
  });
});
