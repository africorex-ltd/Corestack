import { getOrganization } from "../../application/get-organization-query.js";
import { buildOrgScopedContext } from "./context.js";
import { mapErrorToHttpResponse } from "./errors.js";
import { parseUuid } from "./validation.js";
import type { HttpRequest, HttpResponse, TenancyHttpDeps } from "./types.js";

/**
 * `GET /organizations/:id` (Section 3). Path `:id` is the *target*
 * (`getOrganization`'s second parameter) — independent from
 * `context.organizationId` (`X-Organization-Id`, the caller's own
 * resolved scope). If they differ, `getOrganization`'s underlying
 * `findById` call is scoped by RLS/context to the caller's own
 * organization; the row for a *different* id is invisible, and
 * `getOrganization` returns `null` exactly as if the row didn't exist
 * (Section 8: 404, never 403 — see tenancy-http-interface.md's "404 vs
 * 403" section).
 */
export async function handleGetOrganization(
  request: HttpRequest,
  deps: TenancyHttpDeps,
): Promise<HttpResponse> {
  try {
    const targetOrganizationId = parseUuid(request.params.id, "organizationId");
    const context = buildOrgScopedContext(request, deps.ids);

    const organization = await getOrganization(context, targetOrganizationId, {
      uow: deps.uowFactory(context.organizationId),
      repository: deps.organizationRepository,
    });

    if (organization === null) {
      return { status: 404, body: { code: "core/not_found", message: "organization not found" } };
    }
    return { status: 200, body: organization };
  } catch (error) {
    return mapErrorToHttpResponse(error);
  }
}
