/**
 * Organization domain events — E05-T02 Section 6.
 *
 * These are **not** kernel `DomainEvent`s (`@corestack/kernel`'s
 * `event.ts`). That envelope carries `actor`, `correlationId`,
 * `causationId`, a generated `id`, and a contract `version` — all
 * infrastructure/request concerns the aggregate has no access to (it has
 * no `Context`, no `IdGenerator`). A domain event here is just the fact
 * that something happened, recorded with the aggregate's own id and the
 * timestamp it was given.
 *
 * The mapping from these facts to a published, wire-level event (the
 * `ORGANIZATION_CREATED_EVENT` string constant and `OrganizationCreatedPayload`
 * shape already defined in `../application/events.ts` for E05-T01) is a
 * future use case's job (E05-T07+): pull these via
 * `Organization.pullDomainEvents()`, construct a kernel `DomainEvent` via
 * `createEvent(...)` with a resolved `Context`/`IdGenerator`, and publish
 * it through a `UnitOfWork`'s transaction context — the same pattern
 * `examples/acme-crm-module`'s `createContact` use case already
 * demonstrates. That mapping is intentionally not built here; no use case
 * exists yet.
 */

export interface OrganizationCreatedEvent {
  readonly type: "OrganizationCreated";
  readonly organizationId: string;
  readonly occurredAt: Date;
  readonly name: string;
  readonly slug: string;
}

export interface OrganizationRenamedEvent {
  readonly type: "OrganizationRenamed";
  readonly organizationId: string;
  readonly occurredAt: Date;
  readonly previousName: string;
  readonly name: string;
}

export interface OrganizationSuspendedEvent {
  readonly type: "OrganizationSuspended";
  readonly organizationId: string;
  readonly occurredAt: Date;
}

export interface OrganizationReactivatedEvent {
  readonly type: "OrganizationReactivated";
  readonly organizationId: string;
  readonly occurredAt: Date;
}

export interface OrganizationDeletedEvent {
  readonly type: "OrganizationDeleted";
  readonly organizationId: string;
  readonly occurredAt: Date;
}

export type OrganizationDomainEvent =
  | OrganizationCreatedEvent
  | OrganizationRenamedEvent
  | OrganizationSuspendedEvent
  | OrganizationReactivatedEvent
  | OrganizationDeletedEvent;
