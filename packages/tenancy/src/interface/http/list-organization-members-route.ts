import { getOrganization } from "../../application/get-organization-query.js";
import { listOrganizationMembers } from "../../application/list-organization-members-query.js";
import { buildOrgScopedContext } from "./context.js";
import { mapErrorToHttpResponse } from "./errors.js";
import { parseUuid } from "./validation.js";
import type { HttpRequest, HttpResponse, TenancyHttpDeps } from "./types.js";

/**
 * `GET /organizations/:id/members` (Section 3). `listOrganizationMembers`
 * takes only `context` — no independent target parameter the way
 * `getOrganization` has (E05-T12 deliberately did not add one, Section 2
 * of that task). Path `:id` would otherwise be ignored entirely: without
 * the pre-check below, a caller whose `X-Organization-Id` names org A
 * but whose URL names org B would silently receive **org A's** members,
 * while the URL claims org B's — a real correctness bug, not merely a
 * missed security nicety.
 *
 * The fix: call `getOrganization(context, pathOrganizationId, ...)`
 * first. If it returns `null` — either the path organization doesn't
 * exist, or it isn't the one `context` is scoped to — respond 404
 * *before* calling `listOrganizationMembers` at all (Section 8: 404, not
 * 403, for a GET route). This reuses `getOrganization` unchanged
 * (Section 2: "use the existing application/query services only"); it is
 * not a new authorization check invented for this route, it is the only
 * way to make the path parameter load-bearing given
 * `listOrganizationMembers`'s existing shape.
 */
export async function handleListOrganizationMembers(
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

    const members = await listOrganizationMembers(context, {
      uow,
      repository: deps.membershipRepository,
    });
    return { status: 200, body: members };
  } catch (error) {
    return mapErrorToHttpResponse(error);
  }
}
