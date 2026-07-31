import { handleCreateOrganization } from "./create-organization-route.js";
import { handleInviteMember } from "./invite-member-route.js";
import { handleAcceptInvitation } from "./accept-invitation-route.js";
import { handleGetOrganization } from "./get-organization-route.js";
import { handleListOrganizationMembers } from "./list-organization-members-route.js";
import { handleListPendingInvitations } from "./list-pending-invitations-route.js";
import type { RouteDefinition } from "./types.js";

/**
 * The tenancy module's HTTP route table (E05-T13, Section 2/3) —
 * declarative data, not a router. A real binding (Hono, per
 * `docs/architecture/ARCHITECTURE.md` §10/§45) iterates this array and
 * registers each entry with its own path-matching mechanism; nothing in
 * this package matches a path or dispatches a request (Section 14: "do
 * not introduce a controller framework"). Tests in this package call
 * each `handler` directly with a hand-built `HttpRequest`, not through
 * this table.
 *
 * Deliberately **no `/v1` prefix** — `docs/architecture/ARCHITECTURE.md`
 * §26 documents URL-major versioning as the eventual convention, but this
 * task's founder directive (Section 3) specifies these exact paths;
 * versioning is an API-gateway/E14 concern this task does not attempt to
 * anticipate.
 */
export const tenancyRoutes: readonly RouteDefinition[] = [
  { method: "POST", path: "/organizations", handler: handleCreateOrganization },
  {
    method: "POST",
    path: "/organizations/:id/invitations",
    handler: handleInviteMember,
  },
  { method: "POST", path: "/invitations/:id/accept", handler: handleAcceptInvitation },
  { method: "GET", path: "/organizations/:id", handler: handleGetOrganization },
  {
    method: "GET",
    path: "/organizations/:id/members",
    handler: handleListOrganizationMembers,
  },
  {
    method: "GET",
    path: "/organizations/:id/invitations",
    handler: handleListPendingInvitations,
  },
];
