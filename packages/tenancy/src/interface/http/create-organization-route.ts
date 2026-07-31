import { z } from "zod";

import { createOrganization } from "../../application/create-organization.js";
import { buildContext, extractRequestId } from "./context.js";
import { mapErrorToHttpResponse } from "./errors.js";
import { parseBody } from "./validation.js";
import type { HttpRequest, HttpResponse, TenancyHttpDeps } from "./types.js";

const createOrganizationBodySchema = z
  .object({
    name: z.string().trim().min(1),
    slug: z.string().trim().min(1),
  })
  .strict();

/**
 * `POST /organizations` (Section 3). The one route with no organization
 * yet — `context` is a plain `Context`, never `OrgScopedContext`
 * (`createOrganization`'s own signature already requires this; see
 * `create-organization.ts`'s doc comment).
 *
 * `requestedBy` is populated from the extracted actor id
 * (`X-Actor-Id`), **never** from the request body — accepting an
 * arbitrary `requestedBy` string from the body would let any caller
 * claim to be any user (Section 5: actor id is *extracted*, not
 * caller-supplied business data).
 */
export async function handleCreateOrganization(
  request: HttpRequest,
  deps: TenancyHttpDeps,
): Promise<HttpResponse> {
  try {
    const context = buildContext(request, deps.ids);
    const requestId = extractRequestId(request, deps.ids);
    const body = parseBody(createOrganizationBodySchema, request.body);

    const result = await createOrganization(
      context,
      {
        name: body.name,
        slug: body.slug,
        // `Actor.id` is `string | null` at the kernel type level (null only
        // for the system actor), but `buildContext` always constructs a
        // "user" actor from `extractActorId`, which throws before this
        // point if the header is missing — never null here in practice.
        requestedBy: context.actor.id!,
        requestId,
      },
      {
        uow: deps.uowFactory(null),
        repository: deps.organizationRepository,
        ids: deps.ids,
        clock: deps.clock,
      },
    );

    if (!result.ok) return mapErrorToHttpResponse(result.error);
    return { status: 201, body: result.value };
  } catch (error) {
    return mapErrorToHttpResponse(error);
  }
}
