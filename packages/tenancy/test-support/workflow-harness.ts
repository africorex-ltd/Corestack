import {
  FixedClock,
  InMemoryEventBus,
  InMemoryUnitOfWork,
  createContext,
  type Actor,
  type Context,
  type IdGenerator,
  type Result,
  type UnitOfWork,
  type ValidationError,
} from "@corestack/kernel";
import { requireOrgScoped, type OrgScopedContext } from "@corestack/platform";

import {
  createOrganization,
  type CreateOrganizationCommand,
  type CreateOrganizationResult,
} from "../src/application/create-organization.js";
import type { DuplicateSlugError } from "../src/application/duplicate-slug-error.js";
import {
  inviteMember,
  type InviteMemberCommand,
  type InviteMemberResult,
} from "../src/application/invite-member.js";
import type { CannotInviteOwnerError } from "../src/application/cannot-invite-owner-error.js";
import type { InvitationAlreadyExistsError } from "../src/application/invitation-already-exists-error.js";
import type { InviterNotAuthorizedError } from "../src/application/inviter-not-authorized-error.js";
import {
  acceptInvitation,
  type AcceptInvitationCommand,
  type AcceptInvitationResult,
} from "../src/application/accept-invitation.js";
import type { InvitationNotFoundError } from "../src/application/invitation-not-found-error.js";
import type { InvitationExpiredError } from "../src/application/invitation-expired-error.js";
import type { InvitationNotPendingError } from "../src/application/invitation-not-pending-error.js";
import type { MembershipAlreadyExistsError } from "../src/application/membership-already-exists-error.js";
import { DEFAULT_TENANCY_CONFIG, type ResolvedTenancyConfig } from "../src/application/config.js";
import type { ConflictError, ForbiddenError, NotFoundError } from "@corestack/kernel";
import type { OrganizationRepository } from "../src/application/organization-repository.js";
import type { MembershipRepository } from "../src/application/membership-repository.js";
import type { InvitationRepository } from "../src/application/invitation-repository.js";

import { InMemoryOrganizationRepository } from "./in-memory-organization-repository.js";
import { InMemoryMembershipRepository } from "./in-memory-membership-repository.js";
import { InMemoryInvitationRepository } from "./in-memory-invitation-repository.js";
import { EventCollector } from "./event-collector.js";

/** Deterministic, valid-UUID-shaped ids — same test double every `test/application/*.test.ts` file already uses. Not a "shared generic repository" (Section 12) — a plain sequence generator, one per harness instance. */
class SequentialUuidGenerator implements IdGenerator {
  #next = 0;

  generate(): string {
    this.#next += 1;
    return `00000000-0000-7000-8000-${this.#next.toString().padStart(12, "0")}`;
  }
}

const DEFAULT_NOW = new Date("2026-07-30T00:00:00.000Z");
const DEFAULT_ACTOR: Actor = { type: "user", id: "harness-actor" };

export interface TenancyWorkflowHarnessOptions {
  /** Initial clock time. Default: a fixed 2026-07-30 instant. */
  readonly now?: Date;
  /** Default: `DEFAULT_TENANCY_CONFIG` (`invitationExpiryDays: 7`, etc.). */
  readonly config?: ResolvedTenancyConfig;
  /**
   * E05-T11: substitute a real repository set (e.g. the Postgres
   * adapters) for the in-memory reference — Section 10's "reuse the
   * existing workflow harness with a Postgres-backed repository set."
   * All three must be supplied together; omit entirely for the default
   * in-memory behavior.
   */
  readonly repositories?: {
    readonly organizationRepository: OrganizationRepository;
    readonly membershipRepository: MembershipRepository;
    readonly invitationRepository: InvitationRepository;
  };
  /**
   * E05-T11: builds the `UnitOfWork` for a given call, keyed by the
   * organization id that call is scoped to (`null` for `createOrganization`,
   * which is pre-org-scope). Needed because `PostgresUnitOfWork` sets
   * `app.current_org` from a constructor argument fixed at construction
   * time — unlike the in-memory reference (one shared instance for the
   * harness's whole lifetime), a Postgres-backed harness must construct a
   * *fresh* `PostgresUnitOfWork` per call, scoped to whatever organization
   * that specific call targets. Defaults to always returning the same
   * shared in-memory `UnitOfWork`, exactly the prior (pre-E05-T11) behavior.
   */
  readonly uowFactory?: (organizationId: string | null) => UnitOfWork;
}

/**
 * Wires an entire in-memory Tenancy workflow (E05-T08 Section 4):
 * repositories, `UnitOfWork`, a fixed clock, an event collector, and
 * config — then exposes `createOrganization`/`inviteMember`/
 * `acceptInvitation` as thin, strongly-typed wrappers around the real
 * use cases, so a workflow test reads as a sequence of calls rather than
 * re-assembling each use case's dependency object every time.
 *
 * Deliberately not a dependency-injection framework (Section 12): every
 * dependency is a plain, public, readonly field on this class — there is
 * no container, no registration step, no interface beyond the one this
 * class itself defines. A test that needs to inspect or mutate a
 * repository directly (e.g. to seed a `REVOKED` invitation, or to set a
 * repository field for a duplicate-slug test) reaches straight for
 * `harness.invitationRepository`, `harness.organizationRepository`, etc.
 *
 * All three use cases share one `UnitOfWork`/`EventBus` pair — matching
 * how a real composition root wires one module's use cases, and letting
 * a single `harness.events` collector observe the entire workflow's
 * event timeline across multiple use case calls.
 */
export class TenancyWorkflowHarness {
  readonly clock: FixedClock;
  readonly events: EventCollector;
  readonly ids: IdGenerator;
  /** The harness's own default `UnitOfWork` — always the shared in-memory instance, even in Postgres mode (where `#uowFactory` builds a fresh one per call instead of reusing this field). Kept public for tests that assemble their own `deps` object directly (bypassing this harness's wrapper methods) against the in-memory path. */
  readonly uow: UnitOfWork;
  readonly config: ResolvedTenancyConfig;
  readonly organizationRepository: OrganizationRepository;
  readonly membershipRepository: MembershipRepository;
  readonly invitationRepository: InvitationRepository;
  readonly #uowFactory: (organizationId: string | null) => UnitOfWork;

  constructor(options: TenancyWorkflowHarnessOptions = {}) {
    this.clock = new FixedClock(options.now ?? DEFAULT_NOW);
    this.config = options.config ?? DEFAULT_TENANCY_CONFIG;
    this.ids = new SequentialUuidGenerator();
    this.events = new EventCollector();

    const bus = new InMemoryEventBus();
    bus.subscribe({ consumer: "workflow-harness", event: "*", handler: this.events.record });
    this.uow = new InMemoryUnitOfWork(bus);
    this.#uowFactory = options.uowFactory ?? (() => this.uow);

    this.organizationRepository =
      options.repositories?.organizationRepository ?? new InMemoryOrganizationRepository();
    this.membershipRepository =
      options.repositories?.membershipRepository ?? new InMemoryMembershipRepository();
    this.invitationRepository =
      options.repositories?.invitationRepository ?? new InMemoryInvitationRepository();
  }

  /** A fresh, pre-org-scope `Context` — for `createOrganization`, which is necessarily pre-org-scope (E05-T03). */
  context(actor: Actor = DEFAULT_ACTOR): Context {
    return createContext({ actor }, this.ids);
  }

  /** An `OrgScopedContext` for a known organization — for `inviteMember`/`acceptInvitation`. */
  orgContext(organizationId: string, actor: Actor = DEFAULT_ACTOR): OrgScopedContext {
    return requireOrgScoped(createContext({ actor, organizationId }, this.ids));
  }

  async createOrganization(
    command: CreateOrganizationCommand,
    context: Context = this.context(),
  ): Promise<Result<CreateOrganizationResult, ValidationError | DuplicateSlugError>> {
    return createOrganization(context, command, {
      uow: this.#uowFactory(null),
      repository: this.organizationRepository,
      ids: this.ids,
      clock: this.clock,
    });
  }

  async inviteMember(
    context: OrgScopedContext,
    command: InviteMemberCommand,
  ): Promise<
    Result<
      InviteMemberResult,
      | ValidationError
      | ForbiddenError
      | NotFoundError
      | ConflictError
      | CannotInviteOwnerError
      | InvitationAlreadyExistsError
      | InviterNotAuthorizedError
    >
  > {
    return inviteMember(context, command, {
      uow: this.#uowFactory(context.organizationId),
      organizationRepository: this.organizationRepository,
      invitationRepository: this.invitationRepository,
      membershipRepository: this.membershipRepository,
      ids: this.ids,
      clock: this.clock,
      invitationExpiryDays: this.config.invitationExpiryDays,
    });
  }

  async acceptInvitation(
    context: OrgScopedContext,
    command: AcceptInvitationCommand,
  ): Promise<
    Result<
      AcceptInvitationResult,
      | ValidationError
      | ForbiddenError
      | InvitationNotFoundError
      | InvitationExpiredError
      | InvitationNotPendingError
      | MembershipAlreadyExistsError
    >
  > {
    return acceptInvitation(context, command, {
      uow: this.#uowFactory(context.organizationId),
      invitationRepository: this.invitationRepository,
      membershipRepository: this.membershipRepository,
      ids: this.ids,
      clock: this.clock,
    });
  }
}
