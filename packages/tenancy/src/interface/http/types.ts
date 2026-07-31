import type { Clock, IdGenerator, UnitOfWork } from "@corestack/kernel";

import type { OrganizationRepository } from "../../application/organization-repository.js";
import type { MembershipRepository } from "../../application/membership-repository.js";
import type { InvitationRepository } from "../../application/invitation-repository.js";

/**
 * Transport-neutral request shape (E05-T13, Section 2) — deliberately not
 * a Hono/Express/Fastify request. `params` and `query` are already
 * extracted by whatever binding calls a handler (a real Hono binding
 * would populate these from its own router); this package does not parse
 * a URL or match a path pattern itself (Section 14: "do not introduce a
 * controller framework"). `headers` keys are expected lower-cased by the
 * caller, matching how every real HTTP framework normalizes them.
 */
export interface HttpRequest {
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** Already `JSON.parse`d by the caller — this layer never reads raw bytes. `undefined` for GET requests. */
  readonly body?: unknown;
}

/**
 * Transport-neutral response shape. `body` must be JSON-serializable
 * (Section 7: DTOs only) — plain objects/arrays/primitives, `Date`
 * instances (which `JSON.stringify` converts to ISO 8601 UTC via
 * `Date.prototype.toJSON`), never a class instance with methods/private
 * fields and never an `Organization`/`Membership`/`Invitation` aggregate.
 */
export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export type HttpMethod = "GET" | "POST";

/**
 * A route's declarative metadata (Section 2: "route definitions"). No
 * dispatcher/matcher is implemented anywhere in this package — a real
 * binding (Hono, per ARCHITECTURE §10/§45) would iterate `tenancyRoutes`
 * and register each with its own router, extracting `params` per its own
 * convention before constructing an `HttpRequest`. Tests in this package
 * call `handler` directly with a hand-built `HttpRequest`.
 */
export interface RouteDefinition {
  readonly method: HttpMethod;
  /** Documentation-only path template (e.g. `/organizations/:id/members`) — never parsed or matched by this package. */
  readonly path: string;
  readonly handler: (request: HttpRequest, deps: TenancyHttpDeps) => Promise<HttpResponse>;
}

/**
 * Every dependency every route handler needs, collectively — mirrors
 * `TenancyWorkflowHarness`'s constructor shape (test-support, E05-T08/T11)
 * but is this package's own production-facing type, not a test double.
 * `uowFactory` exists for the identical reason `TenancyWorkflowHarness`'s
 * does: a `PostgresUnitOfWork` fixes `app.current_org` at construction, so
 * each request must get a fresh instance scoped to *that request's*
 * resolved `organizationId` (`null` for the one pre-org-scope route,
 * `POST /organizations`).
 */
export interface TenancyHttpDeps {
  readonly uowFactory: (organizationId: string | null) => UnitOfWork;
  readonly organizationRepository: OrganizationRepository;
  readonly membershipRepository: MembershipRepository;
  readonly invitationRepository: InvitationRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly invitationExpiryDays: number;
}
