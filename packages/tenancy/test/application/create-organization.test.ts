import { describe, expect, it, vi } from "vitest";
import {
  FixedClock,
  InMemoryEventBus,
  InMemoryUnitOfWork,
  createContext,
  isErr,
  isOk,
  type Context,
  type DomainEvent,
  type IdGenerator,
  type TransactionContext,
} from "@corestack/kernel";

import type { Organization } from "../../src/domain/organization.js";
import type { OrganizationSlug } from "../../src/domain/organization-slug.js";
import { OrganizationStatus } from "../../src/domain/organization-status.js";
import { DuplicateSlugError } from "../../src/application/duplicate-slug-error.js";
import { ORGANIZATION_CREATED_EVENT } from "../../src/application/events.js";
import {
  createOrganization,
  type CreateOrganizationCommand,
} from "../../src/application/create-organization.js";
import type { OrganizationRepository } from "../../src/application/organization-repository.js";

const NOW = new Date("2026-07-30T00:00:00.000Z");
const VALID_COMMAND: CreateOrganizationCommand = {
  name: "Acme Corp",
  slug: "acme-corp",
  requestedBy: "user-1",
  requestId: "req-1",
};

/** `SequentialIdGenerator`'s "id-1"-style output isn't a valid UUID, and `OrganizationId.from` requires one — this test double yields deterministic, valid-UUID-shaped ids instead. */
class SequentialUuidGenerator implements IdGenerator {
  #next = 0;

  generate(): string {
    this.#next += 1;
    return `00000000-0000-7000-8000-${this.#next.toString().padStart(12, "0")}`;
  }
}

const FIRST_ID = "00000000-0000-7000-8000-000000000001";

/** In-memory repository test double — tracks call counts and holds saved organizations by slug. */
class FakeOrganizationRepository implements OrganizationRepository {
  readonly existingSlugs = new Set<string>();
  readonly saved: Organization[] = [];
  existsBySlugCallCount = 0;
  saveCallCount = 0;

  async findById(): Promise<Organization | null> {
    return null;
  }

  async listForContext(): Promise<readonly Organization[]> {
    return [];
  }

  async existsBySlug(
    _tx: TransactionContext,
    _context: Context,
    slug: OrganizationSlug,
  ): Promise<boolean> {
    this.existsBySlugCallCount += 1;
    return this.existingSlugs.has(slug.value);
  }

  async findBySlug(): Promise<Organization | null> {
    return null;
  }

  async save(_tx: TransactionContext, _context: Context, organization: Organization): Promise<void> {
    this.saveCallCount += 1;
    this.saved.push(organization);
  }
}

function buildHarness() {
  const ids = new SequentialUuidGenerator();
  const clock = new FixedClock(NOW);
  const bus = new InMemoryEventBus();
  const published: DomainEvent[] = [];
  bus.subscribe({ consumer: "test-observer", event: "*", handler: (event) => void published.push(event) });
  const uow = new InMemoryUnitOfWork(bus);
  const repository = new FakeOrganizationRepository();
  // Explicit correlationId so ids.generate() isn't consumed by createContext
  // itself — keeps the aggregate's id deterministically the first one issued.
  const context = createContext(
    { actor: { type: "user", id: "user-1" }, correlationId: "corr-1" },
    ids,
  );

  return { ids, clock, uow, repository, context, published };
}

describe("createOrganization", () => {
  it("creates an organization on success", async () => {
    const { uow, repository, ids, clock, context } = buildHarness();
    const result = await createOrganization(context, VALID_COMMAND, { uow, repository, ids, clock });

    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual({
      organizationId: FIRST_ID,
      slug: "acme-corp",
      status: OrganizationStatus.Active,
      createdAt: NOW,
    });
  });

  it("returns DuplicateSlugError when the slug already exists, without creating or persisting anything", async () => {
    const { uow, repository, ids, clock, context } = buildHarness();
    repository.existingSlugs.add("acme-corp");

    const result = await createOrganization(context, VALID_COMMAND, { uow, repository, ids, clock });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error).toBeInstanceOf(DuplicateSlugError);
    expect(repository.saveCallCount).toBe(0);
    expect(repository.saved).toHaveLength(0);
  });

  it("trims name and slug before use", async () => {
    const { uow, repository, ids, clock, context } = buildHarness();
    const result = await createOrganization(
      context,
      { ...VALID_COMMAND, name: "  Acme Corp  ", slug: "  acme-corp  " },
      { uow, repository, ids, clock },
    );

    expect(isOk(result)).toBe(true);
    expect(repository.saved[0]?.name).toBe("Acme Corp");
    expect(repository.saved[0]?.slug.value).toBe("acme-corp");
  });

  it("publishes an organization.created event on success", async () => {
    const { uow, repository, ids, clock, context, published } = buildHarness();
    await createOrganization(context, VALID_COMMAND, { uow, repository, ids, clock });

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      name: ORGANIZATION_CREATED_EVENT,
      version: 1,
      organizationId: FIRST_ID,
      payload: { organizationId: FIRST_ID, name: "Acme Corp", slug: "acme-corp" },
    });
  });

  it("publishes no events when the slug is a duplicate", async () => {
    const { uow, repository, ids, clock, context, published } = buildHarness();
    repository.existingSlugs.add("acme-corp");

    await createOrganization(context, VALID_COMMAND, { uow, repository, ids, clock });

    expect(published).toHaveLength(0);
  });

  it("publishes no events when domain validation fails", async () => {
    const { uow, repository, ids, clock, context, published } = buildHarness();
    await createOrganization(context, { ...VALID_COMMAND, name: "" }, { uow, repository, ids, clock });

    expect(published).toHaveLength(0);
    expect(repository.saveCallCount).toBe(0);
  });

  it("calls existsBySlug and save exactly once each on success", async () => {
    const { uow, repository, ids, clock, context } = buildHarness();
    await createOrganization(context, VALID_COMMAND, { uow, repository, ids, clock });

    expect(repository.existsBySlugCallCount).toBe(1);
    expect(repository.saveCallCount).toBe(1);
  });

  it("calls existsBySlug but never save when the slug is a duplicate", async () => {
    const { uow, repository, ids, clock, context } = buildHarness();
    repository.existingSlugs.add("acme-corp");

    await createOrganization(context, VALID_COMMAND, { uow, repository, ids, clock });

    expect(repository.existsBySlugCallCount).toBe(1);
    expect(repository.saveCallCount).toBe(0);
  });

  it("runs the whole flow through UnitOfWork.run", async () => {
    const { uow, repository, ids, clock, context } = buildHarness();
    const runSpy = vi.spyOn(uow, "run");

    await createOrganization(context, VALID_COMMAND, { uow, repository, ids, clock });

    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves the clock's timestamp as createdAt", async () => {
    const { uow, repository, ids, context } = buildHarness();
    const clock = new FixedClock(new Date("2020-01-01T00:00:00.000Z"));

    const result = await createOrganization(context, VALID_COMMAND, { uow, repository, ids, clock });

    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.createdAt.getTime()).toBe(new Date("2020-01-01T00:00:00.000Z").getTime());
  });

  it("rejects an empty name with a ValidationError", async () => {
    const { uow, repository, ids, clock, context } = buildHarness();
    const result = await createOrganization(
      context,
      { ...VALID_COMMAND, name: "" },
      { uow, repository, ids, clock },
    );
    expect(isErr(result)).toBe(true);
  });

  it("rejects an invalid slug with a ValidationError, delegating format rules to OrganizationSlug", async () => {
    const { uow, repository, ids, clock, context } = buildHarness();
    const result = await createOrganization(
      context,
      { ...VALID_COMMAND, slug: "Not Valid" },
      { uow, repository, ids, clock },
    );
    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("expected err");
    expect(result.error.message).toMatch(/invalid organization slug/);
  });

  it("rejects an empty requestedBy", async () => {
    const { uow, repository, ids, clock, context } = buildHarness();
    const result = await createOrganization(
      context,
      { ...VALID_COMMAND, requestedBy: "   " },
      { uow, repository, ids, clock },
    );
    expect(isErr(result)).toBe(true);
  });

  it("accepts a requestId but does not yet propagate it anywhere (no idempotency wiring until a later task)", async () => {
    const { uow, repository, ids, clock, context } = buildHarness();
    const result = await createOrganization(
      context,
      { ...VALID_COMMAND, requestId: "some-request-id" },
      { uow, repository, ids, clock },
    );
    expect(isOk(result)).toBe(true);
  });

  it("rejects an empty requestId", async () => {
    const { uow, repository, ids, clock, context } = buildHarness();
    const result = await createOrganization(
      context,
      { ...VALID_COMMAND, requestId: "" },
      { uow, repository, ids, clock },
    );
    expect(isErr(result)).toBe(true);
  });
});
