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
import { createContext, FixedClock, isOk, UuidGenerator, type Context } from "@corestack/kernel";
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
  PostgresOrganizationRepository,
  PostgresMembershipRepository,
  PostgresInvitationRepository,
} from "../../src/postgres/index.js";
import { TenancyWorkflowHarness } from "../../test-support/workflow-harness.js";

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
