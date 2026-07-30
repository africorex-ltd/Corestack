import {
  createEvent,
  err,
  ok,
  ValidationError,
  type Clock,
  type Context,
  type IdGenerator,
  type Result,
  type UnitOfWork,
} from "@corestack/kernel";

import { Organization } from "../domain/organization.js";
import { OrganizationSlug } from "../domain/organization-slug.js";
import type { OrganizationStatus } from "../domain/organization-status.js";
import { DuplicateSlugError } from "./duplicate-slug-error.js";
import { ORGANIZATION_CREATED_EVENT, type OrganizationCreatedPayload } from "./events.js";
import type { OrganizationRepository } from "./organization-repository.js";

export interface CreateOrganizationCommand {
  readonly name: string;
  readonly slug: string;
  /** The user id initiating creation. Not yet consumed by this use case (no Membership/owner exists yet — E05-T03 scope stops at the Organization aggregate) — carried on the command so a future task doesn't need a breaking signature change to reach it. */
  readonly requestedBy: string;
  /** Client-supplied idempotency/correlation token. Validated for presence only; not yet wired to an `IdempotencyStore` or used as `correlationId` — see docs/modules/create-organization-usecase.md's non-goals. */
  readonly requestId: string;
}

/** A DTO, not the aggregate (Section 6) — callers outside this module never see `Organization` directly. */
export interface CreateOrganizationResult {
  readonly organizationId: string;
  readonly slug: string;
  readonly status: OrganizationStatus;
  readonly createdAt: Date;
}

export interface CreateOrganizationDeps {
  /** The generic kernel port, not `PostgresUnitOfWork` — no infrastructure coupling (Section 1). */
  readonly uow: UnitOfWork;
  readonly repository: OrganizationRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/**
 * Runs `fn`, converting a thrown `ValidationError` into `Err`. Anything
 * else rethrows — only the domain layer's own expected-failure type is
 * bridged into `Result` space here; a genuinely unexpected error is still
 * a throw, per the kernel's `Result` convention.
 */
function tryDomain<T>(fn: () => T): Result<T, ValidationError> {
  try {
    return ok(fn());
  } catch (error) {
    if (error instanceof ValidationError) return err(error);
    throw error;
  }
}

/**
 * The `CreateOrganization` use case (E05-T03) — coordinates the
 * `Organization` aggregate, the `OrganizationRepository` port, and
 * `UnitOfWork` event publication. Contains no domain rules of its own
 * (Section 11's permanent policy: "use cases coordinate, they do not
 * contain domain rules") — every invariant (name length, slug format, the
 * status machine) lives in the aggregate and its value objects, built in
 * E05-T02.
 *
 * The entire flow — uniqueness check, aggregate creation, persistence,
 * event publication — runs inside one `UnitOfWork.run()` call (Section
 * 4's "All inside a single UnitOfWork"), so the check-then-write sits in
 * a single atomic unit rather than two independent operations. **This is
 * not yet a hard uniqueness guarantee**: nothing durable enforces it
 * until E05-T21 adds a unique index on the slug column. Until then,
 * `existsBySlug` is a best-effort, friendly-error check — a race between
 * two concurrent requests for the same slug can still both pass it. See
 * docs/modules/create-organization-usecase.md's non-goals.
 */
export async function createOrganization(
  context: Context,
  command: CreateOrganizationCommand,
  deps: CreateOrganizationDeps,
): Promise<Result<CreateOrganizationResult, ValidationError | DuplicateSlugError>> {
  return deps.uow.run(async (tx) => {
    const requestedBy = command.requestedBy.trim();
    if (requestedBy.length === 0) {
      return err(
        new ValidationError("requestedBy must not be empty", { metadata: { field: "requestedBy" } }),
      );
    }
    const requestId = command.requestId.trim();
    if (requestId.length === 0) {
      return err(new ValidationError("requestId must not be empty", { metadata: { field: "requestId" } }));
    }

    // Slug rules are not re-implemented here — delegated to OrganizationSlug
    // (Section 3: "Do not duplicate domain validation unnecessarily").
    const slugResult = tryDomain(() => OrganizationSlug.from(command.slug.trim()));
    if (!slugResult.ok) return slugResult;
    const slug = slugResult.value;

    const alreadyExists = await deps.repository.existsBySlug(context, slug);
    if (alreadyExists) {
      return err(new DuplicateSlugError(slug.value));
    }

    const organizationResult = tryDomain(() =>
      Organization.create({
        id: deps.ids.generate(),
        name: command.name.trim(),
        slug: slug.value,
        now: deps.clock.now(),
      }),
    );
    if (!organizationResult.ok) return organizationResult;
    const organization = organizationResult.value;

    await deps.repository.save(context, organization);

    for (const event of organization.pullDomainEvents()) {
      // Organization.create() only ever emits OrganizationCreated. The
      // other OrganizationDomainEvent types (Renamed/Suspended/
      // Reactivated/Deleted) belong to whichever future use case calls
      // those aggregate methods, not this one.
      if (event.type !== "OrganizationCreated") continue;
      tx.publish(
        createEvent<OrganizationCreatedPayload>(
          {
            name: ORGANIZATION_CREATED_EVENT,
            version: 1,
            organizationId: event.organizationId,
            payload: {
              organizationId: event.organizationId,
              name: event.name,
              slug: event.slug,
            },
          },
          context,
          deps,
        ),
      );
    }
    organization.clearDomainEvents();

    return ok({
      organizationId: organization.id.value,
      slug: organization.slug.value,
      status: organization.status,
      createdAt: organization.createdAt,
    });
  });
}
