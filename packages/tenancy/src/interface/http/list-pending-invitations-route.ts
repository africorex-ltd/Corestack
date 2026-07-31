import { getOrganization } from "../../application/get-organization-query.js";
import { listPendingInvitations } from "../../application/list-pending-invitations-query.js";
import { buildOrgScopedContext } from "./context.js";
import { mapErrorToHttpResponse } from "./errors.js";
import { parseUuid } from "./validation.js";
import type { HttpRequest, HttpResponse, TenancyHttpDeps } from "./types.js";

/**
 * `GET /organizations/:id/invitations` (Section 3). Same shape and same
 * reasoning as `handleListOrganizationMembers` — see that handler's doc
 * comment. `listPendingInvitations` also takes only `context`, so the
 * `getOrganization` pre-check is what makes path `:id` load-bearing and
 * produces 404 (not 403, not a silently-wrong-org's list) for a
 * cross-tenant request.
 */
export async function handleListPendingInvitations(
  request: HttpRequest,
  deps: TenancyHttpDeps,
): Promise<HttpResponse> {
  try {
    const targetOrganizationId = parseUuid(request.params.id, "organizationId");
    const context = buildOrgScopedContext(request, deps.ids);
    const uow = deps.uowFactory(context.organizationId);

    const organization = await getOrganization(context, targetOrganizationId, {
      uow,
      repository: deps.organizationRepository,
    });
    if (organization === null) {
      return { status: 404, body: { code: "core/not_found", message: "organization not found" } };
    }

    const invitations = await listPendingInvitations(context, {
      uow,
      repository: deps.invitationRepository,
    });
    return { status: 200, body: invitations };
  } catch (error) {
    return mapErrorToHttpResponse(error);
  }
}
