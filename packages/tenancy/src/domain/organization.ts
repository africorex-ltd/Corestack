import { ConflictError, ValidationError } from "@corestack/kernel";

import { OrganizationId } from "./organization-id.js";
import { OrganizationSlug } from "./organization-slug.js";
import {
  OrganizationStatus,
  isLegalOrganizationStatusTransition,
} from "./organization-status.js";
import type { OrganizationDomainEvent } from "./organization-events.js";

const MIN_NAME_LENGTH = 1;
const MAX_NAME_LENGTH = 120;

/** Invariant: name is 1–120 characters (Section 7). No further shaping (whitespace-only names are accepted — not a stated invariant, not invented here). */
function assertValidName(name: string): string {
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(
      `organization name must be ${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters, got ${name.length}`,
      { metadata: { length: name.length } },
    );
  }
  return name;
}

export interface CreateOrganizationInput {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  /** Caller-supplied timestamp — the aggregate never reads the wall clock itself (domain code takes time as data, per `@corestack/kernel`'s `Clock` port doc). */
  readonly now: Date;
}

/** Full persisted state — every field this aggregate carries, as plain values. No `now`: unlike `create`, reconstitution has no "current instant" of its own. */
export interface ReconstituteOrganizationInput {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: OrganizationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/**
 * The `Organization` aggregate (E05-T02) — a pure domain model with no
 * persistence, no I/O, and no dependency on any kernel *port* (it takes
 * plain `Date` values, not a `Clock`, and a plain `id: string`, not an
 * `IdGenerator` — both resolved by the caller, matching how
 * `examples/acme-crm-module`'s `createContact` use case already threads
 * `deps.ids`/`deps.clock` down to plain values before touching domain
 * code).
 *
 * Every field is a private (`#`) class field with no public setter — the
 * five methods below (`rename`, `suspend`, `reactivate`, `delete`, plus
 * the `create` factory) are the only way to change state. This is
 * "explicit methods only, no public mutation" (Section 5) enforced
 * structurally, not by convention.
 */
export class Organization {
  readonly #id: OrganizationId;
  #name: string;
  #slug: OrganizationSlug;
  #status: OrganizationStatus;
  readonly #createdAt: Date;
  #updatedAt: Date;
  #deletedAt: Date | null;
  #domainEvents: OrganizationDomainEvent[];

  private constructor(
    id: OrganizationId,
    name: string,
    slug: OrganizationSlug,
    status: OrganizationStatus,
    createdAt: Date,
    updatedAt: Date,
    deletedAt: Date | null,
  ) {
    this.#id = id;
    this.#name = name;
    this.#slug = slug;
    this.#status = status;
    this.#createdAt = createdAt;
    this.#updatedAt = updatedAt;
    this.#deletedAt = deletedAt;
    this.#domainEvents = [];
  }

  /** Creates a new, `ACTIVE` organization and records `OrganizationCreated`. */
  static create(input: CreateOrganizationInput): Organization {
    const id = OrganizationId.from(input.id);
    const name = assertValidName(input.name);
    const slug = OrganizationSlug.from(input.slug);

    const organization = new Organization(
      id,
      name,
      slug,
      OrganizationStatus.Active,
      input.now,
      input.now,
      null,
    );
    organization.#domainEvents.push({
      type: "OrganizationCreated",
      organizationId: id.value,
      occurredAt: input.now,
      name,
      slug: slug.value,
    });
    return organization;
  }

  /**
   * Rebuilds an `Organization` from its full persisted state — a
   * repository mapper's counterpart to `create` (E05-T11). Emits **no**
   * domain event: loading an already-existing row is not a new business
   * fact, unlike `create`, which always emits `OrganizationCreated`. Does
   * not re-validate invariants that only make sense at creation time
   * (e.g. name length) — a persisted row is assumed to already satisfy
   * whatever invariants were enforced when it was written; this factory's
   * job is reconstruction, not re-validation.
   */
  static reconstitute(input: ReconstituteOrganizationInput): Organization {
    return new Organization(
      OrganizationId.from(input.id),
      input.name,
      OrganizationSlug.from(input.slug),
      input.status,
      input.createdAt,
      input.updatedAt,
      input.deletedAt,
    );
  }

  get id(): OrganizationId {
    return this.#id;
  }

  get name(): string {
    return this.#name;
  }

  get slug(): OrganizationSlug {
    return this.#slug;
  }

  get status(): OrganizationStatus {
    return this.#status;
  }

  get createdAt(): Date {
    return new Date(this.#createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.#updatedAt.getTime());
  }

  /** `null` unless `status` is `DELETED`. */
  get deletedAt(): Date | null {
    return this.#deletedAt === null ? null : new Date(this.#deletedAt.getTime());
  }

  /**
   * Invariant: a deleted organization cannot change (Section 7) —
   * enforced here for `rename`, which has no entry in the status
   * transition table to fail against on its own.
   */
  #assertNotDeleted(operation: string): void {
    if (this.#status === OrganizationStatus.Deleted) {
      throw new ConflictError(`cannot ${operation} a deleted organization`, {
        metadata: { organizationId: this.#id.value, operation },
      });
    }
  }

  /**
   * Invariant: timestamps are monotonic (Section 7) — a caller-supplied
   * `now` earlier than the aggregate's last `updatedAt` is rejected
   * rather than silently clamped or accepted, since a caller passing a
   * stale clock reading is a bug worth surfacing, not papering over.
   */
  #assertMonotonic(now: Date): void {
    if (now.getTime() < this.#updatedAt.getTime()) {
      throw new ValidationError(
        "timestamp must not precede the organization's last update",
        {
          metadata: {
            organizationId: this.#id.value,
            updatedAt: this.#updatedAt.toISOString(),
            attempted: now.toISOString(),
          },
        },
      );
    }
  }

  /**
   * Renames the organization. A rename to the current name is a no-op
   * (Section 7): no event, no `updatedAt` change — distinct from
   * `suspend`/`reactivate`, where a same-state call is an *error*, not a
   * no-op (see `organization-status.ts`'s transition-table comment).
   */
  rename(name: string, now: Date): void {
    this.#assertNotDeleted("rename");
    const nextName = assertValidName(name);
    if (nextName === this.#name) return;
    this.#assertMonotonic(now);

    const previousName = this.#name;
    this.#name = nextName;
    this.#updatedAt = now;
    this.#domainEvents.push({
      type: "OrganizationRenamed",
      organizationId: this.#id.value,
      occurredAt: now,
      previousName,
      name: nextName,
    });
  }

  #transitionTo(to: OrganizationStatus, now: Date): void {
    if (!isLegalOrganizationStatusTransition(this.#status, to)) {
      throw new ConflictError(
        `cannot transition organization from ${this.#status} to ${to}`,
        { metadata: { organizationId: this.#id.value, from: this.#status, to } },
      );
    }
    this.#assertMonotonic(now);
    this.#status = to;
    this.#updatedAt = now;
  }

  /** `ACTIVE` → `SUSPENDED`. Already-`SUSPENDED` (or `DELETED`) is an illegal transition, not a no-op. */
  suspend(now: Date): void {
    this.#transitionTo(OrganizationStatus.Suspended, now);
    this.#domainEvents.push({
      type: "OrganizationSuspended",
      organizationId: this.#id.value,
      occurredAt: now,
    });
  }

  /** `SUSPENDED` → `ACTIVE`. Already-`ACTIVE` (or `DELETED`) is an illegal transition, not a no-op. */
  reactivate(now: Date): void {
    this.#transitionTo(OrganizationStatus.Active, now);
    this.#domainEvents.push({
      type: "OrganizationReactivated",
      organizationId: this.#id.value,
      occurredAt: now,
    });
  }

  /** `ACTIVE`/`SUSPENDED` → `DELETED`. `DELETED` is terminal — no transition out, including this one called twice. */
  delete(now: Date): void {
    this.#transitionTo(OrganizationStatus.Deleted, now);
    this.#deletedAt = now;
    this.#domainEvents.push({
      type: "OrganizationDeleted",
      organizationId: this.#id.value,
      occurredAt: now,
    });
  }

  /**
   * Returns every domain event recorded since the last `clearDomainEvents()`
   * (or since construction). Non-destructive — call `clearDomainEvents()`
   * separately once the caller has durably handed the events off (Section 8).
   */
  pullDomainEvents(): readonly OrganizationDomainEvent[] {
    return [...this.#domainEvents];
  }

  clearDomainEvents(): void {
    this.#domainEvents = [];
  }
}
