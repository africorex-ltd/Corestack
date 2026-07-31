/**
 * Real-Postgres integration tests for the Tenancy repository adapters
 * (E05-T11, Section 9/10). Runs against a dual-mode harness (local
 * `DATABASE_URL` scratch database, or a Testcontainers `postgres:16-alpine`
 * fallback when unset) — mirrors `packages/platform/test-support/
 * test-database.ts`'s exact strategy; that module is private to
 * `@corestack/platform`'s own tests (not part of its public surface, since
 * it depends on `postgres`/`@testcontainers/postgresql`, both optional
 * peers), so this file reimplements the same two-mode bootstrap locally
 * rather than reaching across a package boundary into another package's
 * internal `test-support/`.
 *
 * Every repository call runs through a genuinely authenticated
 * `tenancy_app` connection (never the superuser session) — proving RLS is
 * actually enforced, not merely defined, matching E03-T31/E03's own
 * golden-path precedent (`examples/acme-crm-module`'s own integration
 * test). The superuser connection (`superuserSql`) is used only for
 * fixture setup/teardown and out-of-band assertions that must see across
 * every organization (e.g. confirming an outbox row landed).
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createContext,
  createEvent,
  FixedClock,
  isOk,
  UuidGenerator,
  type Context,
} from "@corestack/kernel";
import {
  FsMigrationSource,
  loadMigrationSet,
  requireOrgScoped,
  runMigrations,
  type MigrationSet,
  type OrgScopedContext,
} from "@corestack/platform";
import {
  ensureMigrationTrackingSchema,
  ensureOutboxSchema,
  PostgresMigrationRunnerStore,
  PostgresUnitOfWork,
  type PostgresTransactionContext,
} from "@corestack/platform/postgres";

import { Organization } from "../../src/domain/organization.js";
import { OrganizationSlug } from "../../src/domain/organization-slug.js";
import { OrganizationStatus } from "../../src/domain/organization-status.js";
import { Membership } from "../../src/domain/membership.js";
import { MembershipRole } from "../../src/domain/membership-role.js";
import { MembershipStatus } from "../../src/domain/membership-status.js";
import { Invitation } from "../../src/domain/invitation.js";
import { InvitationRole } from "../../src/domain/invitation-role.js";
import { InvitationStatus } from "../../src/domain/invitation-status.js";
import { DuplicateSlugError } from "../../src/application/duplicate-slug-error.js";
import { MembershipAlreadyExistsError } from "../../src/application/membership-already-exists-error.js";
import { InvitationAlreadyExistsError } from "../../src/application/invitation-already-exists-error.js";
import { getOrganization } from "../../src/application/get-organization-query.js";
import { listOrganizationMembers } from "../../src/application/list-organization-members-query.js";
import { listPendingInvitations } from "../../src/application/list-pending-invitations-query.js";
import {
  ensureTenancyModuleRoles,
  TENANCY_APP_ROLE,
  TENANCY_PLATFORM_ROLE,
  PostgresOrganizationRepository,
  PostgresMembershipRepository,
  PostgresInvitationRepository,
  PostgresNotificationWorkItemRepository,
  createInvitationNotificationSubscription,
  processNextNotificationWorkItem,
} from "../../src/postgres/index.js";
import { MAX_NOTIFICATION_DELIVERY_ATTEMPTS } from "../../src/application/notification-processing-decisions.js";
import type { NotificationWorkItem } from "../../src/application/notification-work-item.js";
import { RecordingNotificationDeliveryAdapter } from "../../test-support/recording-notification-delivery-adapter.js";
import {
  INVITATION_CREATED_EVENT,
  INVITATION_ACCEPTED_EVENT,
  INVITATION_EXPIRED_EVENT,
  type InvitationCreatedPayload,
  type InvitationAcceptedPayload,
  type InvitationExpiredPayload,
} from "../../src/application/events.js";
import { TenancyWorkflowHarness } from "../../test-support/workflow-harness.js";
import { handleCreateOrganization } from "../../src/interface/http/create-organization-route.js";
import { handleInviteMember } from "../../src/interface/http/invite-member-route.js";
import { handleAcceptInvitation } from "../../src/interface/http/accept-invitation-route.js";
import { handleGetOrganization } from "../../src/interface/http/get-organization-route.js";
import { handleListOrganizationMembers } from "../../src/interface/http/list-organization-members-route.js";
import { handleListPendingInvitations } from "../../src/interface/http/list-pending-invitations-route.js";
import type { HttpRequest, TenancyHttpDeps } from "../../src/interface/http/types.js";

const DATABASE_URL = process.env.DATABASE_URL;
const APP_ROLE_PASSWORD = "test-only-scratch-db-password";
const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const REFERENCE_DATE = new Date("2026-07-30T00:00:00.000Z");

let admin: Sql | undefined;
let container: StartedPostgreSqlContainer | undefined;
let dbName: string | undefined;
let superuserSql: Sql;
let appRoleSql: Sql;
let migrations: MigrationSet;

const organizationRepository = new PostgresOrganizationRepository();
const membershipRepository = new PostgresMembershipRepository();
const invitationRepository = new PostgresInvitationRepository();
const ids = new UuidGenerator();
const clock = new FixedClock(REFERENCE_DATE);

/** Runs `fn` inside a single `PostgresUnitOfWork`, scoped to `organizationId` (`null` for pre-org-scope organization operations) — the only sanctioned way any of these repositories may be called (Section 3: no independent transactions inside a repository). */
async function withUow<T>(
  organizationId: string | null,
  fn: (tx: PostgresTransactionContext) => Promise<T>,
): Promise<T> {
  return new PostgresUnitOfWork(appRoleSql, organizationId).run(fn);
}

function plainContext(): Context {
  return createContext({ actor: { type: "user", id: randomUUID() } }, ids);
}

function orgContext(organizationId: string): OrgScopedContext {
  return requireOrgScoped(
    createContext({ actor: { type: "user", id: randomUUID() }, organizationId }, ids),
  );
}

beforeAll(async () => {
  let connectionString: string;

  if (DATABASE_URL !== undefined) {
    admin = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
    dbName = `tenancy_test_${randomUUID().replace(/-/g, "")}`;
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const url = new URL(DATABASE_URL);
    url.pathname = `/${dbName}`;
    connectionString = url.toString();
  } else {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    connectionString = container.getConnectionUri();
  }

  superuserSql = postgres(connectionString, { max: 5, onnotice: () => {} });

  await ensureMigrationTrackingSchema(superuserSql);
  await ensureOutboxSchema(superuserSql, { referenceDate: REFERENCE_DATE });
  await ensureTenancyModuleRoles(superuserSql);

  const migrationSetResult = await loadMigrationSet(
    "tenancy",
    new FsMigrationSource({ baseDir: MIGRATIONS_DIR }),
  );
  if (!isOk(migrationSetResult)) {
    throw new Error(`failed to load tenancy migrations: ${migrationSetResult.error.message}`);
  }
  migrations = migrationSetResult.value;

  const runResult = await runMigrations(migrations, new PostgresMigrationRunnerStore(superuserSql));
  if (!isOk(runResult)) {
    throw new Error(`failed to apply tenancy migrations: ${runResult.error.message}`);
  }

  // Test-only: a genuinely authenticated tenancy_app connection — real
  // production credentials remain an unresolved deployment decision
  // (Residual Risk R3, docs/security/tenant-isolation-certification.md);
  // this mirrors E03-T31/acme-crm-module's own precedent exactly.
  await superuserSql.unsafe(
    `ALTER ROLE ${TENANCY_APP_ROLE} LOGIN PASSWORD '${APP_ROLE_PASSWORD}'`,
  );
  const appRoleUrl = new URL(connectionString);
  appRoleUrl.username = TENANCY_APP_ROLE;
  appRoleUrl.password = APP_ROLE_PASSWORD;
  appRoleSql = postgres(appRoleUrl.toString(), { max: 5, onnotice: () => {} });
}, 120_000);

afterAll(async () => {
  await appRoleSql?.end({ timeout: 5 });
  await superuserSql?.end({ timeout: 5 });
  if (admin !== undefined && dbName !== undefined) {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
  await container?.stop();
});

beforeEach(async () => {
  await superuserSql`DELETE FROM tenancy.invitations`;
  await superuserSql`DELETE FROM tenancy.memberships`;
  await superuserSql`DELETE FROM tenancy.organizations`;
  await superuserSql`DELETE FROM platform.outbox`;
});

function activeOrganization(overrides: { id?: string; slug?: string } = {}): Organization {
  return Organization.create({
    id: overrides.id ?? randomUUID(),
    name: "Acme Corp",
    slug: overrides.slug ?? `acme-${randomUUID().slice(0, 8)}`,
    now: REFERENCE_DATE,
  });
}

describe("PostgresOrganizationRepository", () => {
  it("saves and loads an organization round-trip, with timestamps and enum preserved exactly", async () => {
    const organization = activeOrganization();

    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), organization));

    const loaded = await withUow(organization.id.value, (tx) =>
      organizationRepository.findById(tx, orgContext(organization.id.value), organization.id.value),
    );

    expect(loaded).not.toBeNull();
    expect(loaded?.id.value).toBe(organization.id.value);
    expect(loaded?.slug.value).toBe(organization.slug.value);
    expect(loaded?.name).toBe(organization.name);
    expect(loaded?.status).toBe(OrganizationStatus.Active);
    expect(loaded?.createdAt.getTime()).toBe(organization.createdAt.getTime());
    expect(loaded?.updatedAt.getTime()).toBe(organization.updatedAt.getTime());
    expect(loaded?.deletedAt).toBeNull();
  });

  it("enforces slug uniqueness at the database — the second save throws DuplicateSlugError", async () => {
    const slug = `dup-${randomUUID().slice(0, 8)}`;
    const first = activeOrganization({ slug });
    const second = activeOrganization({ slug });

    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), first));

    await expect(
      withUow(null, (tx) => organizationRepository.save(tx, plainContext(), second)),
    ).rejects.toBeInstanceOf(DuplicateSlugError);
  });

  it("soft-deletes: status DELETED and deletedAt set, row still present", async () => {
    const organization = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), organization));

    organization.delete(new Date(REFERENCE_DATE.getTime() + 1000));
    await withUow(organization.id.value, (tx) =>
      organizationRepository.save(tx, plainContext(), organization),
    );

    const loaded = await withUow(organization.id.value, (tx) =>
      organizationRepository.findById(tx, orgContext(organization.id.value), organization.id.value),
    );
    expect(loaded?.status).toBe(OrganizationStatus.Deleted);
    expect(loaded?.deletedAt).not.toBeNull();

    const stillInTable = await superuserSql`
      SELECT id FROM tenancy.organizations WHERE id = ${organization.id.value}::uuid
    `;
    expect(stillInTable).toHaveLength(1);
  });

  it("RLS isolation: an app-role session scoped to org A cannot see org B's row via findById", async () => {
    const orgA = activeOrganization();
    const orgB = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgA));
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgB));

    const seenFromA = await withUow(orgA.id.value, (tx) =>
      organizationRepository.findById(tx, orgContext(orgA.id.value), orgB.id.value),
    );
    expect(seenFromA).toBeNull();
  });

  it("existsBySlug (platform-role elevation) sees a slug from a different organization's context", async () => {
    const existing = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), existing));

    const exists = await withUow(null, (tx) =>
      organizationRepository.existsBySlug(tx, plainContext(), existing.slug),
    );
    expect(exists).toBe(true);

    const missing = await withUow(null, (tx) =>
      organizationRepository.existsBySlug(
        tx,
        plainContext(),
        OrganizationSlug.from(`never-used-${randomUUID().slice(0, 8)}`),
      ),
    );
    expect(missing).toBe(false);
  });

  it("findBySlug returns the organization for any slug, cross-tenant", async () => {
    const existing = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), existing));

    const found = await withUow(null, (tx) =>
      organizationRepository.findBySlug(tx, plainContext(), existing.slug),
    );
    expect(found?.id.value).toBe(existing.id.value);
  });
});

describe("PostgresMembershipRepository", () => {
  it("saves and loads a membership round-trip, with role/status/timestamps preserved", async () => {
    const organization = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), organization));

    const userId = randomUUID();
    const membership = Membership.create({
      id: randomUUID(),
      organizationId: organization.id.value,
      userId,
      role: MembershipRole.Admin,
      now: REFERENCE_DATE,
    });

    await withUow(organization.id.value, (tx) =>
      membershipRepository.save(tx, orgContext(organization.id.value), membership),
    );

    const loaded = await withUow(organization.id.value, (tx) =>
      membershipRepository.findById(tx, orgContext(organization.id.value), membership.id.value),
    );
    expect(loaded?.role).toBe(MembershipRole.Admin);
    expect(loaded?.status).toBe(MembershipStatus.Active);
    expect(loaded?.joinedAt.getTime()).toBe(membership.joinedAt.getTime());
    expect(loaded?.updatedAt.getTime()).toBe(membership.updatedAt.getTime());
    expect(loaded?.removedAt).toBeNull();
  });

  it("enforces active-membership uniqueness at the database — the second concurrent membership throws MembershipAlreadyExistsError", async () => {
    const organization = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), organization));
    const userId = randomUUID();

    const first = Membership.create({
      id: randomUUID(),
      organizationId: organization.id.value,
      userId,
      role: MembershipRole.Member,
      now: REFERENCE_DATE,
    });
    const second = Membership.create({
      id: randomUUID(),
      organizationId: organization.id.value,
      userId,
      role: MembershipRole.Member,
      now: REFERENCE_DATE,
    });

    await withUow(organization.id.value, (tx) =>
      membershipRepository.save(tx, orgContext(organization.id.value), first),
    );

    await expect(
      withUow(organization.id.value, (tx) =>
        membershipRepository.save(tx, orgContext(organization.id.value), second),
      ),
    ).rejects.toBeInstanceOf(MembershipAlreadyExistsError);
  });

  it("soft-removes: status REMOVED and removedAt set, row still present", async () => {
    const organization = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), organization));
    const membership = Membership.create({
      id: randomUUID(),
      organizationId: organization.id.value,
      userId: randomUUID(),
      role: MembershipRole.Member,
      now: REFERENCE_DATE,
    });
    await withUow(organization.id.value, (tx) =>
      membershipRepository.save(tx, orgContext(organization.id.value), membership),
    );

    membership.remove(new Date(REFERENCE_DATE.getTime() + 1000));
    await withUow(organization.id.value, (tx) =>
      membershipRepository.save(tx, orgContext(organization.id.value), membership),
    );

    const loaded = await withUow(organization.id.value, (tx) =>
      membershipRepository.findById(tx, orgContext(organization.id.value), membership.id.value),
    );
    expect(loaded?.status).toBe(MembershipStatus.Removed);
    expect(loaded?.removedAt).not.toBeNull();

    const stillInTable = await superuserSql`
      SELECT id FROM tenancy.memberships WHERE id = ${membership.id.value}::uuid
    `;
    expect(stillInTable).toHaveLength(1);
  });

  it("RLS isolation: org A's session never sees org B's memberships via listForOrganization", async () => {
    const orgA = activeOrganization();
    const orgB = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgA));
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgB));

    const membershipB = Membership.create({
      id: randomUUID(),
      organizationId: orgB.id.value,
      userId: randomUUID(),
      role: MembershipRole.Owner,
      now: REFERENCE_DATE,
    });
    await withUow(orgB.id.value, (tx) =>
      membershipRepository.save(tx, orgContext(orgB.id.value), membershipB),
    );

    const seenFromA = await withUow(orgA.id.value, (tx) =>
      membershipRepository.listForOrganization(tx, orgContext(orgA.id.value)),
    );
    expect(seenFromA).toEqual([]);
  });
});

describe("PostgresInvitationRepository", () => {
  it("saves and loads an invitation round-trip, with role/status/timestamps preserved", async () => {
    const organization = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), organization));

    const invitation = Invitation.create({
      id: randomUUID(),
      organizationId: organization.id.value,
      email: "invitee@example.com",
      role: InvitationRole.Member,
      invitedBy: randomUUID(),
      now: REFERENCE_DATE,
      expiresAt: new Date(REFERENCE_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    await withUow(organization.id.value, (tx) =>
      invitationRepository.save(tx, orgContext(organization.id.value), invitation),
    );

    const loaded = await withUow(organization.id.value, (tx) =>
      invitationRepository.findById(tx, orgContext(organization.id.value), invitation.id.value),
    );
    expect(loaded?.email.value).toBe("invitee@example.com");
    expect(loaded?.role).toBe(InvitationRole.Member);
    expect(loaded?.status).toBe(InvitationStatus.Pending);
    expect(loaded?.createdAt.getTime()).toBe(invitation.createdAt.getTime());
    expect(loaded?.expiresAt.getTime()).toBe(invitation.expiresAt.getTime());
    expect(loaded?.respondedAt).toBeNull();
  });

  it("enforces pending-invitation uniqueness at the database — the second concurrent invitation throws InvitationAlreadyExistsError", async () => {
    const organization = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), organization));
    const email = "duplicate@example.com";

    const first = Invitation.create({
      id: randomUUID(),
      organizationId: organization.id.value,
      email,
      role: InvitationRole.Member,
      invitedBy: randomUUID(),
      now: REFERENCE_DATE,
      expiresAt: new Date(REFERENCE_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    const second = Invitation.create({
      id: randomUUID(),
      organizationId: organization.id.value,
      email,
      role: InvitationRole.Member,
      invitedBy: randomUUID(),
      now: REFERENCE_DATE,
      expiresAt: new Date(REFERENCE_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    await withUow(organization.id.value, (tx) =>
      invitationRepository.save(tx, orgContext(organization.id.value), first),
    );

    await expect(
      withUow(organization.id.value, (tx) =>
        invitationRepository.save(tx, orgContext(organization.id.value), second),
      ),
    ).rejects.toBeInstanceOf(InvitationAlreadyExistsError);
  });

  it("revokes: status REVOKED and respondedAt set, row still present", async () => {
    const organization = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), organization));
    const invitation = Invitation.create({
      id: randomUUID(),
      organizationId: organization.id.value,
      email: "revoke-me@example.com",
      role: InvitationRole.Member,
      invitedBy: randomUUID(),
      now: REFERENCE_DATE,
      expiresAt: new Date(REFERENCE_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    await withUow(organization.id.value, (tx) =>
      invitationRepository.save(tx, orgContext(organization.id.value), invitation),
    );

    invitation.revoke(new Date(REFERENCE_DATE.getTime() + 1000));
    await withUow(organization.id.value, (tx) =>
      invitationRepository.save(tx, orgContext(organization.id.value), invitation),
    );

    const loaded = await withUow(organization.id.value, (tx) =>
      invitationRepository.findById(tx, orgContext(organization.id.value), invitation.id.value),
    );
    expect(loaded?.status).toBe(InvitationStatus.Revoked);
    expect(loaded?.respondedAt).not.toBeNull();
  });

  it("RLS isolation: org A's session never sees org B's invitations via listForOrganization", async () => {
    const orgA = activeOrganization();
    const orgB = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgA));
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgB));

    const invitationB = Invitation.create({
      id: randomUUID(),
      organizationId: orgB.id.value,
      email: "org-b-invitee@example.com",
      role: InvitationRole.Member,
      invitedBy: randomUUID(),
      now: REFERENCE_DATE,
      expiresAt: new Date(REFERENCE_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    await withUow(orgB.id.value, (tx) =>
      invitationRepository.save(tx, orgContext(orgB.id.value), invitationB),
    );

    const seenFromA = await withUow(orgA.id.value, (tx) =>
      invitationRepository.listForOrganization(tx, orgContext(orgA.id.value)),
    );
    expect(seenFromA).toEqual([]);
  });
});

describe("Tenancy workflow (E05-T08 scenarios re-run against real Postgres, Section 10)", () => {
  function buildHarness(): TenancyWorkflowHarness {
    return new TenancyWorkflowHarness({
      now: REFERENCE_DATE,
      repositories: { organizationRepository, membershipRepository, invitationRepository },
      uowFactory: (organizationId) => new PostgresUnitOfWork(appRoleSql, organizationId),
    });
  }

  it("create -> invite -> accept golden path commits atomically against real Postgres", async () => {
    const harness = buildHarness();
    const slug = `acme-${randomUUID().slice(0, 8)}`;
    const ownerId = randomUUID();
    const memberId = randomUUID();

    const created = await harness.createOrganization(
      {
        name: "Acme Corp",
        slug,
        requestedBy: ownerId,
        requestId: "req-create",
      },
      harness.context({ type: "user", id: ownerId }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const organizationId = created.value.organizationId;

    const ownerContext = orgContext(organizationId);
    const ownerMembership = Membership.create({
      id: randomUUID(),
      organizationId,
      userId: ownerId,
      role: MembershipRole.Owner,
      now: clock.now(),
    });
    await withUow(organizationId, (tx) =>
      membershipRepository.save(tx, ownerContext, ownerMembership),
    );

    const invited = await harness.inviteMember(ownerContext, {
      organizationId,
      email: "member@example.com",
      role: InvitationRole.Member,
      invitedBy: ownerId,
      requestId: "req-invite",
    });
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;

    const accepted = await harness.acceptInvitation(ownerContext, {
      invitationId: invited.value.invitationId,
      userId: memberId,
      email: "member@example.com",
      requestId: "req-accept",
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.role).toBe(MembershipRole.Member);

    // The whole workflow's events landed in platform.outbox atomically with
    // their business-data writes (PostgresUnitOfWork's transactional outbox).
    const outboxRows = await superuserSql`
      SELECT event_name FROM platform.outbox WHERE organization_id = ${organizationId}::uuid
    `;
    expect(outboxRows.map((r) => r.event_name).sort()).toEqual(
      ["invitation.accepted", "invitation.created", "member.joined", "organization.created"].sort(),
    );

    // E05-T12 Section 9: the read side, exercised against the same seeded
    // scenario rather than a separately-seeded query-only test.
    const organization = await harness.getOrganization(ownerContext);
    expect(organization?.slug).toBe(slug);
    expect(organization?.status).toBe(OrganizationStatus.Active);

    const members = await harness.listOrganizationMembers(ownerContext);
    expect(members.map((m) => m.userId).sort()).toEqual([memberId, ownerId].sort());
    expect(members.every((m) => !("removedAt" in m))).toBe(true);

    // The one invitation from this scenario is now ACCEPTED, not PENDING.
    const pendingInvitations = await harness.listPendingInvitations(ownerContext);
    expect(pendingInvitations).toEqual([]);
  });

  it("duplicate slug creation is rejected as DuplicateSlugError through the full use case, backed by the real unique constraint", async () => {
    const harness = buildHarness();
    const slug = `acme-dup-${randomUUID().slice(0, 8)}`;

    const first = await harness.createOrganization(
      {
        name: "First Org",
        slug,
        requestedBy: randomUUID(),
        requestId: "req-1",
      },
      harness.context({ type: "user", id: randomUUID() }),
    );
    expect(first.ok).toBe(true);

    const second = await harness.createOrganization(
      {
        name: "Second Org",
        slug,
        requestedBy: randomUUID(),
        requestId: "req-2",
      },
      harness.context({ type: "user", id: randomUUID() }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBeInstanceOf(DuplicateSlugError);
  });
});

describe("Tenancy query services (E05-T12, Section 8: RLS verification)", () => {
  /** A fresh `PostgresUnitOfWork` scoped to `organizationId` — matching exactly how `TenancyWorkflowHarness`'s own `uowFactory` builds one per query call. */
  function queryUow(organizationId: string): PostgresUnitOfWork {
    return new PostgresUnitOfWork(appRoleSql, organizationId);
  }

  it("getOrganization: organization A cannot see organization B", async () => {
    const orgA = activeOrganization();
    const orgB = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgA));
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgB));

    const seenFromA = await getOrganization(orgContext(orgA.id.value), orgB.id.value, {
      uow: queryUow(orgA.id.value),
      repository: organizationRepository,
    });
    expect(seenFromA).toBeNull();

    const seenFromOwnContext = await getOrganization(orgContext(orgA.id.value), orgA.id.value, {
      uow: queryUow(orgA.id.value),
      repository: organizationRepository,
    });
    expect(seenFromOwnContext?.id).toBe(orgA.id.value);
  });

  it("listOrganizationMembers: organization A cannot list organization B's members", async () => {
    const orgA = activeOrganization();
    const orgB = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgA));
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgB));

    // Seed a membership in *both* organizations — an empty result from org
    // A would prove nothing if org A had no members of its own to
    // (correctly) see; asserting the exact non-empty set is what actually
    // discriminates "RLS filtered out B" from "there was nothing to leak."
    const membershipA = Membership.create({
      id: randomUUID(),
      organizationId: orgA.id.value,
      userId: randomUUID(),
      role: MembershipRole.Owner,
      now: REFERENCE_DATE,
    });
    await withUow(orgA.id.value, (tx) =>
      membershipRepository.save(tx, orgContext(orgA.id.value), membershipA),
    );
    const membershipB = Membership.create({
      id: randomUUID(),
      organizationId: orgB.id.value,
      userId: randomUUID(),
      role: MembershipRole.Owner,
      now: REFERENCE_DATE,
    });
    await withUow(orgB.id.value, (tx) =>
      membershipRepository.save(tx, orgContext(orgB.id.value), membershipB),
    );

    const membersSeenFromA = await listOrganizationMembers(orgContext(orgA.id.value), {
      uow: queryUow(orgA.id.value),
      repository: membershipRepository,
    });
    expect(membersSeenFromA.map((m) => m.id)).toEqual([membershipA.id.value]);
  });

  it("listPendingInvitations: organization A cannot list organization B's invitations", async () => {
    const orgA = activeOrganization();
    const orgB = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgA));
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgB));

    // Seed a pending invitation in *both* organizations, for the same
    // reason as the membership test above — an empty result must mean
    // "RLS filtered B out," not "org A had nothing to see either."
    const invitationA = Invitation.create({
      id: randomUUID(),
      organizationId: orgA.id.value,
      email: "org-a-query-test@example.com",
      role: InvitationRole.Member,
      invitedBy: randomUUID(),
      now: REFERENCE_DATE,
      expiresAt: new Date(REFERENCE_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    await withUow(orgA.id.value, (tx) =>
      invitationRepository.save(tx, orgContext(orgA.id.value), invitationA),
    );
    const invitationB = Invitation.create({
      id: randomUUID(),
      organizationId: orgB.id.value,
      email: "org-b-query-test@example.com",
      role: InvitationRole.Member,
      invitedBy: randomUUID(),
      now: REFERENCE_DATE,
      expiresAt: new Date(REFERENCE_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    await withUow(orgB.id.value, (tx) =>
      invitationRepository.save(tx, orgContext(orgB.id.value), invitationB),
    );

    const invitationsSeenFromA = await listPendingInvitations(orgContext(orgA.id.value), {
      uow: queryUow(orgA.id.value),
      repository: invitationRepository,
    });
    expect(invitationsSeenFromA.map((i) => i.id)).toEqual([invitationA.id.value]);
  });

  it("elevated uniqueness checks (existsBySlug) do not leak into getOrganization's visibility", async () => {
    const orgA = activeOrganization();
    const orgB = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgA));
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), orgB));

    // existsBySlug elevates to the platform role for its one query
    // (E05-T11) and correctly sees org B's slug from org A's own
    // transaction. That elevation must not leave the transaction able to
    // see org B's full row afterwards — RESET ROLE must have actually
    // reverted it before getOrganization runs in the same transaction.
    const seenFromA = await withUow(orgA.id.value, async (tx) => {
      const slugExists = await organizationRepository.existsBySlug(tx, plainContext(), orgB.slug);
      expect(slugExists).toBe(true);

      return getOrganization(orgContext(orgA.id.value), orgB.id.value, {
        uow: { run: (fn) => fn(tx) },
        repository: organizationRepository,
      });
    });
    expect(seenFromA).toBeNull();
  });
});

describe("Tenancy HTTP interface (E05-T13)", () => {
  function buildHttpDeps(): TenancyHttpDeps {
    return {
      uowFactory: (organizationId) => new PostgresUnitOfWork(appRoleSql, organizationId),
      organizationRepository,
      membershipRepository,
      invitationRepository,
      ids,
      clock,
      invitationExpiryDays: 7,
    };
  }

  /** Seeds an ACTIVE organization with an OWNER membership, directly via the repositories (bypassing HTTP) — the same setup pattern the repository/query-service describe blocks above already use. */
  async function seedActiveOrgWithOwner(
    ownerId: string,
  ): Promise<{ organizationId: string; slug: string }> {
    const organization = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), organization));

    const ownerMembership = Membership.create({
      id: randomUUID(),
      organizationId: organization.id.value,
      userId: ownerId,
      role: MembershipRole.Owner,
      now: REFERENCE_DATE,
    });
    await withUow(organization.id.value, (tx) =>
      membershipRepository.save(tx, orgContext(organization.id.value), ownerMembership),
    );

    return { organizationId: organization.id.value, slug: organization.slug.value };
  }

  function httpRequest(
    params: Record<string, string | undefined>,
    headers: Record<string, string | undefined>,
    body?: unknown,
  ): HttpRequest {
    return { params, headers, body };
  }

  it("POST /organizations: successful create (201)", async () => {
    const actorId = randomUUID();
    const slug = `acme-${randomUUID().slice(0, 8)}`;

    const response = await handleCreateOrganization(
      httpRequest({}, { "x-actor-id": actorId }, { name: "Acme Corp", slug }),
      buildHttpDeps(),
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ slug, status: OrganizationStatus.Active });
  });

  it("POST /organizations: duplicate slug conflict (409)", async () => {
    const actorId = randomUUID();
    const slug = `acme-dup-${randomUUID().slice(0, 8)}`;
    const deps = buildHttpDeps();

    const first = await handleCreateOrganization(
      httpRequest({}, { "x-actor-id": actorId }, { name: "First", slug }),
      deps,
    );
    expect(first.status).toBe(201);

    const second = await handleCreateOrganization(
      httpRequest({}, { "x-actor-id": randomUUID() }, { name: "Second", slug }),
      deps,
    );
    expect(second.status).toBe(409);
  });

  it("POST /organizations: validation failure for a missing body field (400)", async () => {
    const response = await handleCreateOrganization(
      httpRequest({}, { "x-actor-id": randomUUID() }, { name: "Acme Corp" }),
      buildHttpDeps(),
    );
    expect(response.status).toBe(400);
  });

  it("POST /organizations/:id/invitations: successful invite (201)", async () => {
    const ownerId = randomUUID();
    const { organizationId } = await seedActiveOrgWithOwner(ownerId);

    const response = await handleInviteMember(
      httpRequest(
        { id: organizationId },
        { "x-actor-id": ownerId, "x-organization-id": organizationId },
        { email: "invitee@example.com", role: "MEMBER" },
      ),
      buildHttpDeps(),
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ email: "invitee@example.com", role: "MEMBER" });
  });

  it("POST /organizations/:id/invitations: authorization failure — actor has no membership (403)", async () => {
    const ownerId = randomUUID();
    const { organizationId } = await seedActiveOrgWithOwner(ownerId);
    const strangerId = randomUUID();

    const response = await handleInviteMember(
      httpRequest(
        { id: organizationId },
        { "x-actor-id": strangerId, "x-organization-id": organizationId },
        { email: "invitee@example.com", role: "MEMBER" },
      ),
      buildHttpDeps(),
    );

    expect(response.status).toBe(403);
  });

  it("POST /organizations/:id/invitations: duplicate pending invitation conflict (409)", async () => {
    const ownerId = randomUUID();
    const { organizationId } = await seedActiveOrgWithOwner(ownerId);
    const deps = buildHttpDeps();
    const email = "invitee@example.com";

    const first = await handleInviteMember(
      httpRequest(
        { id: organizationId },
        { "x-actor-id": ownerId, "x-organization-id": organizationId },
        { email, role: "MEMBER" },
      ),
      deps,
    );
    expect(first.status).toBe(201);

    const second = await handleInviteMember(
      httpRequest(
        { id: organizationId },
        { "x-actor-id": ownerId, "x-organization-id": organizationId },
        { email, role: "MEMBER" },
      ),
      deps,
    );
    expect(second.status).toBe(409);
  });

  it("POST /organizations/:id/invitations: validation failure for a malformed email (400)", async () => {
    const ownerId = randomUUID();
    const { organizationId } = await seedActiveOrgWithOwner(ownerId);

    const response = await handleInviteMember(
      httpRequest(
        { id: organizationId },
        { "x-actor-id": ownerId, "x-organization-id": organizationId },
        { email: "not-an-email", role: "MEMBER" },
      ),
      buildHttpDeps(),
    );
    expect(response.status).toBe(400);
  });

  it("POST /invitations/:id/accept: successful accept (200)", async () => {
    const ownerId = randomUUID();
    const acceptorId = randomUUID();
    const { organizationId } = await seedActiveOrgWithOwner(ownerId);
    const deps = buildHttpDeps();

    const invited = await handleInviteMember(
      httpRequest(
        { id: organizationId },
        { "x-actor-id": ownerId, "x-organization-id": organizationId },
        { email: "invitee@example.com", role: "MEMBER" },
      ),
      deps,
    );
    expect(invited.status).toBe(201);
    const invitationId = (invited.body as { invitationId: string }).invitationId;

    const accepted = await handleAcceptInvitation(
      httpRequest(
        { id: invitationId },
        { "x-actor-id": acceptorId, "x-organization-id": organizationId },
        { email: "invitee@example.com" },
      ),
      deps,
    );

    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ userId: acceptorId, role: "MEMBER" });
  });

  it("GET /organizations/:id: successful read (200)", async () => {
    const ownerId = randomUUID();
    const { organizationId, slug } = await seedActiveOrgWithOwner(ownerId);

    const response = await handleGetOrganization(
      httpRequest(
        { id: organizationId },
        { "x-actor-id": ownerId, "x-organization-id": organizationId },
      ),
      buildHttpDeps(),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: organizationId, slug });
  });

  it("GET /organizations/:id: cross-tenant invisibility — 404, never 403 (real RLS)", async () => {
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const { organizationId: orgA } = await seedActiveOrgWithOwner(ownerA);
    const { organizationId: orgB } = await seedActiveOrgWithOwner(ownerB);

    const response = await handleGetOrganization(
      httpRequest({ id: orgB }, { "x-actor-id": ownerA, "x-organization-id": orgA }),
      buildHttpDeps(),
    );

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
  });

  it("GET /organizations/:id/members: successful read (200)", async () => {
    const ownerId = randomUUID();
    const { organizationId } = await seedActiveOrgWithOwner(ownerId);

    const response = await handleListOrganizationMembers(
      httpRequest(
        { id: organizationId },
        { "x-actor-id": ownerId, "x-organization-id": organizationId },
      ),
      buildHttpDeps(),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ userId: ownerId, role: "OWNER" })]);
  });

  it("GET /organizations/:id/members: cross-tenant invisibility — 404, never a silent wrong-org list (real RLS)", async () => {
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const { organizationId: orgA } = await seedActiveOrgWithOwner(ownerA);
    const { organizationId: orgB } = await seedActiveOrgWithOwner(ownerB);

    const response = await handleListOrganizationMembers(
      httpRequest({ id: orgB }, { "x-actor-id": ownerA, "x-organization-id": orgA }),
      buildHttpDeps(),
    );

    expect(response.status).toBe(404);
    expect(Array.isArray(response.body)).toBe(false);
  });

  it("GET /organizations/:id/invitations: successful read (200)", async () => {
    const ownerId = randomUUID();
    const { organizationId } = await seedActiveOrgWithOwner(ownerId);
    const deps = buildHttpDeps();

    const invited = await handleInviteMember(
      httpRequest(
        { id: organizationId },
        { "x-actor-id": ownerId, "x-organization-id": organizationId },
        { email: "invitee@example.com", role: "MEMBER" },
      ),
      deps,
    );
    expect(invited.status).toBe(201);

    const response = await handleListPendingInvitations(
      httpRequest(
        { id: organizationId },
        { "x-actor-id": ownerId, "x-organization-id": organizationId },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({ email: "invitee@example.com", role: "MEMBER" }),
    ]);
  });

  it("GET /organizations/:id/invitations: cross-tenant invisibility — 404, never a silent wrong-org list (real RLS)", async () => {
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const { organizationId: orgA } = await seedActiveOrgWithOwner(ownerA);
    const { organizationId: orgB } = await seedActiveOrgWithOwner(ownerB);

    const response = await handleListPendingInvitations(
      httpRequest({ id: orgB }, { "x-actor-id": ownerA, "x-organization-id": orgA }),
      buildHttpDeps(),
    );

    expect(response.status).toBe(404);
    expect(Array.isArray(response.body)).toBe(false);
  });
});

describe("Invitation-notification consumer (E05-T14)", () => {
  /** A fresh org, real row in tenancy.organizations — notification_work_items FKs to it. */
  async function seedOrganization(): Promise<string> {
    const organization = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), organization));
    return organization.id.value;
  }

  function buildEvent<TPayload>(name: string, organizationId: string | null, payload: TPayload) {
    const context = createContext({ actor: { type: "system", id: null }, organizationId }, ids);
    return createEvent({ name, version: 1, payload }, context, { clock, ids });
  }

  async function countWorkItems(organizationId: string): Promise<number> {
    const rows = await superuserSql`
      SELECT 1 FROM tenancy.notification_work_items WHERE organization_id = ${organizationId}::uuid
    `;
    return rows.length;
  }

  async function isEventProcessed(eventId: string): Promise<boolean> {
    const rows = await superuserSql`
      SELECT 1 FROM platform.processed_events
      WHERE consumer = 'tenancy:invitation-notifications' AND event_id = ${eventId}::uuid
    `;
    return rows.length > 0;
  }

  it("INVITATION_CREATED produces a PENDING work item with the invitee email as recipient", async () => {
    const organizationId = await seedOrganization();
    const invitationId = randomUUID();
    const subscription = createInvitationNotificationSubscription({ sql: appRoleSql, ids, clock });
    const payload: InvitationCreatedPayload = {
      invitationId,
      organizationId,
      email: "invitee@example.com",
      role: "MEMBER",
      invitedBy: randomUUID(),
      expiresAt: "2026-08-07T00:00:00.000Z",
    };
    const event = buildEvent(INVITATION_CREATED_EVENT, organizationId, payload);

    await subscription.handler(event);

    const rows = await superuserSql`
      SELECT type, organization_id, invitation_id, recipient, payload, status, attempts, processed_at, last_error
      FROM tenancy.notification_work_items
      WHERE organization_id = ${organizationId}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("INVITATION_CREATED");
    expect(rows[0]?.invitation_id).toBe(invitationId);
    expect(rows[0]?.recipient).toBe("invitee@example.com");
    expect(rows[0]?.payload).toEqual(payload);
    expect(rows[0]?.status).toBe("PENDING");
    expect(rows[0]?.attempts).toBe(0);
    expect(rows[0]?.processed_at).toBeNull();
    expect(rows[0]?.last_error).toBeNull();
    expect(await isEventProcessed(event.id)).toBe(true);
  });

  it("a duplicate delivery of the same event produces no duplicate work item", async () => {
    const organizationId = await seedOrganization();
    const subscription = createInvitationNotificationSubscription({ sql: appRoleSql, ids, clock });
    const payload: InvitationCreatedPayload = {
      invitationId: randomUUID(),
      organizationId,
      email: "invitee@example.com",
      role: "MEMBER",
      invitedBy: randomUUID(),
      expiresAt: "2026-08-07T00:00:00.000Z",
    };
    const event = buildEvent(INVITATION_CREATED_EVENT, organizationId, payload);

    await subscription.handler(event);
    await subscription.handler(event);

    expect(await countWorkItems(organizationId)).toBe(1);
  });

  it("INVITATION_ACCEPTED produces a work item with a null recipient (Section 5: no I/O to resolve one)", async () => {
    const organizationId = await seedOrganization();
    const subscription = createInvitationNotificationSubscription({ sql: appRoleSql, ids, clock });
    const payload: InvitationAcceptedPayload = { invitationId: randomUUID(), organizationId };
    const event = buildEvent(INVITATION_ACCEPTED_EVENT, organizationId, payload);

    await subscription.handler(event);

    const rows = await superuserSql`
      SELECT type, recipient FROM tenancy.notification_work_items WHERE organization_id = ${organizationId}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("INVITATION_ACCEPTED");
    expect(rows[0]?.recipient).toBeNull();
  });

  it("INVITATION_EXPIRED produces a work item with a null recipient", async () => {
    const organizationId = await seedOrganization();
    const subscription = createInvitationNotificationSubscription({ sql: appRoleSql, ids, clock });
    const payload: InvitationExpiredPayload = { invitationId: randomUUID(), organizationId };
    const event = buildEvent(INVITATION_EXPIRED_EVENT, organizationId, payload);

    await subscription.handler(event);

    const rows = await superuserSql`
      SELECT type, recipient FROM tenancy.notification_work_items WHERE organization_id = ${organizationId}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("INVITATION_EXPIRED");
    expect(rows[0]?.recipient).toBeNull();
  });

  it("replay safety: a brand-new subscription instance (simulating a process restart) still no-ops on an already-processed event", async () => {
    const organizationId = await seedOrganization();
    const payload: InvitationCreatedPayload = {
      invitationId: randomUUID(),
      organizationId,
      email: "invitee@example.com",
      role: "ADMIN",
      invitedBy: randomUUID(),
      expiresAt: "2026-08-07T00:00:00.000Z",
    };
    const event = buildEvent(INVITATION_CREATED_EVENT, organizationId, payload);

    const first = createInvitationNotificationSubscription({ sql: appRoleSql, ids, clock });
    await first.handler(event);
    expect(await countWorkItems(organizationId)).toBe(1);

    // A fresh subscription — no shared in-memory state with `first` at
    // all, only the same Postgres connection — proves durability rests
    // entirely on platform.processed_events, not on anything the handler
    // remembers between calls.
    const replay = createInvitationNotificationSubscription({ sql: appRoleSql, ids, clock });
    await expect(replay.handler(event)).resolves.toBeUndefined();
    expect(await countWorkItems(organizationId)).toBe(1);
  });

  it("transaction rollback safety: a failed insert leaves neither a work item nor a processed-event mark behind", async () => {
    const organizationId = await seedOrganization();
    const subscription = createInvitationNotificationSubscription({ sql: appRoleSql, ids, clock });
    // A malformed invitationId breaks the INSERT's own `::uuid` cast —
    // forcing a real Postgres error partway through the handler's
    // transaction, without needing to fake or mock anything.
    const payload: InvitationCreatedPayload = {
      invitationId: "not-a-uuid",
      organizationId,
      email: "invitee@example.com",
      role: "MEMBER",
      invitedBy: randomUUID(),
      expiresAt: "2026-08-07T00:00:00.000Z",
    };
    const event = buildEvent(INVITATION_CREATED_EVENT, organizationId, payload);

    // Asserting on the specific failure mode (not just "throws") matters
    // here: a permission error elsewhere in the transaction would also
    // make this test pass for the wrong reason without this check.
    await expect(subscription.handler(event)).rejects.toThrow(/invalid input syntax/i);

    expect(await countWorkItems(organizationId)).toBe(0);
    expect(await isEventProcessed(event.id)).toBe(false);
  });

  it("ignores MEMBER_JOINED and any other unrecognized event name (Section 3)", async () => {
    const organizationId = await seedOrganization();
    const subscription = createInvitationNotificationSubscription({ sql: appRoleSql, ids, clock });
    const event = buildEvent("tenancy.member.joined", organizationId, {
      organizationId,
      membershipId: randomUUID(),
      userId: randomUUID(),
      role: "MEMBER",
    });

    await subscription.handler(event);

    expect(await countWorkItems(organizationId)).toBe(0);
  });
});

describe("Notification processing service (E05-T15)", () => {
  /** A fresh org, real row in tenancy.organizations — notification_work_items FKs to it. */
  async function seedOrganization(): Promise<string> {
    const organization = activeOrganization();
    await withUow(null, (tx) => organizationRepository.save(tx, plainContext(), organization));
    return organization.id.value;
  }

  /**
   * Inserts a work item directly, bypassing both the repository's `create`
   * and the event-driven builder — this describe block tests the
   * processing side in isolation, so it needs full control over seeded
   * `status`/`attempts`/`recipient` combinations, including one
   * (`INVITATION_CREATED` + `recipient: null`) the normal write path never
   * produces but the schema doesn't forbid either.
   */
  async function insertWorkItem(overrides: {
    readonly organizationId: string;
    readonly type?: "INVITATION_CREATED" | "INVITATION_ACCEPTED" | "INVITATION_EXPIRED";
    readonly recipient?: string | null;
    readonly status?: "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED";
    readonly attempts?: number;
    readonly createdAt?: Date;
  }): Promise<string> {
    const id = randomUUID();
    await superuserSql`
      INSERT INTO tenancy.notification_work_items
        (id, type, organization_id, invitation_id, recipient, payload, status, attempts, created_at, processed_at, last_error)
      VALUES (
        ${id}::uuid,
        ${overrides.type ?? "INVITATION_CREATED"},
        ${overrides.organizationId}::uuid,
        ${randomUUID()}::uuid,
        ${overrides.recipient === undefined ? "invitee@example.com" : overrides.recipient},
        ${superuserSql.json({})},
        ${overrides.status ?? "PENDING"},
        ${overrides.attempts ?? 0},
        ${overrides.createdAt ?? REFERENCE_DATE},
        NULL,
        NULL
      )
    `;
    return id;
  }

  /** Opens one elevated transaction and calls `claimNextPending` directly — used only to hold a claim's row lock open past its own statement, so a concurrent second claim can be proven to run while that lock is still live (see the two SKIP LOCKED tests below). */
  const notificationWorkItemRepository = new PostgresNotificationWorkItemRepository();
  async function claimNextPendingHeldOpen(releaseGate: Promise<void>): Promise<NotificationWorkItem | null> {
    return new PostgresUnitOfWork(appRoleSql, null).run(async (tx) => {
      await tx.sql.unsafe(`SET LOCAL ROLE ${TENANCY_PLATFORM_ROLE}`);
      const claimed = await notificationWorkItemRepository.claimNextPending(tx);
      await releaseGate;
      return claimed;
    });
  }
  async function claimNextPendingOnce(): Promise<NotificationWorkItem | null> {
    return new PostgresUnitOfWork(appRoleSql, null).run(async (tx) => {
      await tx.sql.unsafe(`SET LOCAL ROLE ${TENANCY_PLATFORM_ROLE}`);
      return notificationWorkItemRepository.claimNextPending(tx);
    });
  }

  async function loadWorkItem(id: string): Promise<{
    status: string;
    attempts: number;
    processed_at: Date | null;
    last_error: string | null;
  }> {
    const rows = await superuserSql<
      { status: string; attempts: number; processed_at: Date | null; last_error: string | null }[]
    >`
      SELECT status, attempts, processed_at, last_error
      FROM tenancy.notification_work_items WHERE id = ${id}::uuid
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new Error(`work item ${id} not found`);
    }
    return row;
  }

  it("successfully processes a PENDING item: PROCESSED, processedAt set, delivery invoked exactly once", async () => {
    const organizationId = await seedOrganization();
    const id = await insertWorkItem({ organizationId, recipient: "invitee@example.com" });
    const delivery = new RecordingNotificationDeliveryAdapter();

    const result = await processNextNotificationWorkItem({ sql: appRoleSql, clock, delivery });

    expect(result).toEqual({ outcome: "processed", workItemId: id });
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]).toEqual({
      method: "deliverInvitationCreated",
      payload: expect.objectContaining({ organizationId, recipient: "invitee@example.com" }),
    });

    const row = await loadWorkItem(id);
    expect(row.status).toBe("PROCESSED");
    expect(row.attempts).toBe(0);
    expect(row.processed_at).not.toBeNull();
    expect(row.last_error).toBeNull();
  });

  it("returns no_pending_work when nothing is PENDING", async () => {
    const delivery = new RecordingNotificationDeliveryAdapter();
    const result = await processNextNotificationWorkItem({ sql: appRoleSql, clock, delivery });
    expect(result).toEqual({ outcome: "no_pending_work" });
    expect(delivery.deliveries).toHaveLength(0);
  });

  it("replay of a processed item is prevented: a second call finds nothing left to claim", async () => {
    const organizationId = await seedOrganization();
    const id = await insertWorkItem({ organizationId });
    const delivery = new RecordingNotificationDeliveryAdapter();

    const first = await processNextNotificationWorkItem({ sql: appRoleSql, clock, delivery });
    expect(first).toEqual({ outcome: "processed", workItemId: id });

    const second = await processNextNotificationWorkItem({ sql: appRoleSql, clock, delivery });
    expect(second).toEqual({ outcome: "no_pending_work" });
    expect(delivery.deliveries).toHaveLength(1);
  });

  it("exactly-once claim: a second claim genuinely overlapping the first's still-open transaction gets null, never the same row", async () => {
    const organizationId = await seedOrganization();
    const id = await insertWorkItem({ organizationId });

    // `claimNextPendingHeldOpen` claims the row and then blocks on `gate`
    // *before* committing — its transaction, and the row lock the claim's
    // UPDATE took, stay open for as long as we don't resolve `gate`. This
    // is what forces genuine overlap: the second claim below is only
    // awaited (and thus only able to complete) if SKIP LOCKED lets it
    // return without waiting on that still-held lock. If SKIP LOCKED were
    // removed from the query, the second claim would block on the first
    // transaction's row lock and this test would hang until timeout,
    // rather than silently passing for the wrong reason.
    let releaseA: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const claimAPromise = claimNextPendingHeldOpen(gate);

    // Give A's transaction a moment to actually reach the database and
    // acquire the row lock before B's claim races it.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const claimedByB = await claimNextPendingOnce();
    expect(claimedByB).toBeNull();

    releaseA();
    const claimedByA = await claimAPromise;
    expect(claimedByA?.id).toBe(id);

    const row = await loadWorkItem(id);
    expect(row.status).toBe("PROCESSING");
  });

  it("concurrent claim safety: a second claim skips a row still locked by the first and takes the other available row without waiting", async () => {
    const organizationId = await seedOrganization();
    const idOldest = await insertWorkItem({ organizationId, createdAt: REFERENCE_DATE });
    const idNewest = await insertWorkItem({
      organizationId,
      createdAt: new Date(REFERENCE_DATE.getTime() + 1000),
    });

    let releaseA: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    // A claims the oldest row (claimNextPending orders by created_at ASC)
    // and holds its transaction open past that claim.
    const claimAPromise = claimNextPendingHeldOpen(gate);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // B is only reached here, before `releaseA()` is ever called — if
    // SKIP LOCKED did not skip idOldest's held lock and instead blocked
    // on it (as a plain FOR UPDATE would), this call would never resolve
    // and the test would time out rather than pass for the wrong reason.
    const claimedByB = await claimNextPendingOnce();
    expect(claimedByB?.id).toBe(idNewest);

    releaseA();
    const claimedByA = await claimAPromise;
    expect(claimedByA?.id).toBe(idOldest);

    expect((await loadWorkItem(idOldest)).status).toBe("PROCESSING");
    expect((await loadWorkItem(idNewest)).status).toBe("PROCESSING");
  });

  it("a transient delivery failure increments attempts, records lastError, and returns the item to PENDING", async () => {
    const organizationId = await seedOrganization();
    const id = await insertWorkItem({ organizationId });
    const delivery = new RecordingNotificationDeliveryAdapter();
    delivery.failNextWith(new Error("simulated provider timeout"));

    const result = await processNextNotificationWorkItem({ sql: appRoleSql, clock, delivery });

    expect(result).toEqual({
      outcome: "failed",
      workItemId: id,
      status: "PENDING",
      lastError: "simulated provider timeout",
    });
    const row = await loadWorkItem(id);
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(1);
    expect(row.processed_at).toBeNull();
    expect(row.last_error).toBe("simulated provider timeout");
  });

  it("repeated transient failures exhaust the retry budget and resolve to terminal FAILED", async () => {
    const organizationId = await seedOrganization();
    const id = await insertWorkItem({ organizationId, attempts: MAX_NOTIFICATION_DELIVERY_ATTEMPTS - 1 });
    const delivery = new RecordingNotificationDeliveryAdapter();
    delivery.failNextWith(new Error("still failing"));

    const result = await processNextNotificationWorkItem({ sql: appRoleSql, clock, delivery });

    expect(result).toEqual({
      outcome: "failed",
      workItemId: id,
      status: "FAILED",
      lastError: "still failing",
    });
    const row = await loadWorkItem(id);
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(MAX_NOTIFICATION_DELIVERY_ATTEMPTS);

    // A FAILED row is never claimed again — the row is kept, not lost.
    const again = await processNextNotificationWorkItem({ sql: appRoleSql, clock, delivery });
    expect(again).toEqual({ outcome: "no_pending_work" });
  });

  it("a permanently malformed item (INVITATION_CREATED with no recipient) fails immediately, bypassing the retry budget", async () => {
    const organizationId = await seedOrganization();
    const id = await insertWorkItem({ organizationId, type: "INVITATION_CREATED", recipient: null });
    const delivery = new RecordingNotificationDeliveryAdapter();

    const result = await processNextNotificationWorkItem({ sql: appRoleSql, clock, delivery });

    expect(result.outcome).toBe("failed");
    expect(result).toMatchObject({ status: "FAILED" });
    if (result.outcome === "failed") {
      expect(result.lastError).toMatch(/has no recipient/);
    }
    expect(delivery.deliveries).toHaveLength(0);

    const row = await loadWorkItem(id);
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(1);
  });
});
