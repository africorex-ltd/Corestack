import { createContext, type Context, type IdGenerator } from "@corestack/kernel";
import { requireOrgScoped, type OrgScopedContext } from "@corestack/platform";

import { parseUuid, requireHeader } from "./validation.js";
import type { HttpRequest } from "./types.js";

const ACTOR_ID_HEADER = "x-actor-id";
const ORGANIZATION_ID_HEADER = "x-organization-id";
const REQUEST_ID_HEADER = "x-request-id";

/**
 * Extracts the request id from `X-Request-Id` if present (Section 5;
 * mirrors API.md §19's "accepted, else generated" convention), else
 * generates a fresh one. Used as both `command.requestId` (every
 * write-side use case requires one) and `context.correlationId`, so a
 * single request has one identifier threaded through both.
 */
export function extractRequestId(request: HttpRequest, ids: IdGenerator): string {
  const header = request.headers[REQUEST_ID_HEADER];
  return header !== undefined && header.trim().length > 0 ? header.trim() : ids.generate();
}

/**
 * Extracts the caller's actor id from `X-Actor-Id` — a deliberate
 * stand-in for whatever a real authentication provider will eventually
 * inject (Section 1 of this task's own founder directive explicitly
 * excludes implementing one). Validated as UUID-shaped on **every**
 * route, uniformly, even `POST /organizations` (whose `requestedBy`
 * field is not itself UUID-validated by `createOrganization`) — a
 * malformed value must never reach `UserId.from()` (invite/accept) or a
 * repository's `::uuid` cast unchecked (Section 6: that would surface as
 * a raw Postgres error, not a clean 400). See
 * docs/modules/tenancy-http-interface.md's "Trust boundary" section for
 * why this header exists at all and what replaces it once a real auth
 * provider is built.
 */
export function extractActorId(request: HttpRequest): string {
  const header = requireHeader(request.headers, ACTOR_ID_HEADER);
  return parseUuid(header, ACTOR_ID_HEADER);
}

/**
 * Extracts the caller's own organization scope from `X-Organization-Id` —
 * **never** from the URL path, even on routes whose path also names an
 * organization (`docs/security/how-to-build-a-tenant-safe-feature.md`
 * step 1: "never trust a client-claimed organizationId directly"). A
 * path segment naming an organization (`/organizations/:id`, etc.) is a
 * *target* or *claim*, checked against this value by the use case
 * (`inviteMember`) or by RLS (`getOrganization`) — never used to
 * *construct* this value. See tenancy-http-interface.md's "404 vs 403"
 * section.
 */
export function extractOrganizationId(request: HttpRequest): string {
  const header = requireHeader(request.headers, ORGANIZATION_ID_HEADER);
  return parseUuid(header, ORGANIZATION_ID_HEADER);
}

/** Builds a pre-org-scope `Context` — for `POST /organizations` only, the one route with no organization yet. */
export function buildContext(request: HttpRequest, ids: IdGenerator): Context {
  const actorId = extractActorId(request);
  const requestId = extractRequestId(request, ids);
  return createContext(
    { actor: { type: "user", id: actorId }, correlationId: requestId },
    ids,
  );
}

/** Builds an `OrgScopedContext` from `X-Actor-Id`/`X-Organization-Id`/`X-Request-Id` — for every other route. */
export function buildOrgScopedContext(request: HttpRequest, ids: IdGenerator): OrgScopedContext {
  const actorId = extractActorId(request);
  const organizationId = extractOrganizationId(request);
  const requestId = extractRequestId(request, ids);
  return requireOrgScoped(
    createContext(
      { actor: { type: "user", id: actorId }, organizationId, correlationId: requestId },
      ids,
    ),
  );
}
