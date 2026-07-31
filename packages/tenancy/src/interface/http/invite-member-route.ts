import { z } from "zod";

import { inviteMember } from "../../application/invite-member.js";
import { buildOrgScopedContext, extractRequestId } from "./context.js";
import { mapErrorToHttpResponse } from "./errors.js";
import { parseBody, parseEmail, parseUuid } from "./validation.js";
import type { HttpRequest, HttpResponse, TenancyHttpDeps } from "./types.js";

/**
 * `role` is restricted to the two legal `InvitationRole` values at this
 * boundary (Section 4: "validate role values") — **not** the wider
 * `"OWNER"` string `inviteMember`'s own `CannotInviteOwnerError` also
 * rejects. Consequence, documented in
 * docs/modules/tenancy-http-interface.md's error-mapping table: an
 * `"OWNER"` request is rejected here (400, generic Zod-shaped message)
 * one layer before it would reach `inviteMember`'s own dedicated
 * `CannotInviteOwnerError` — that error type remains reachable (and
 * tested) for any non-HTTP caller of `inviteMember` directly, it is just
 * not observable through this route.
 */
const inviteMemberBodySchema = z
  .object({
    email: z.string().trim().min(1),
    role: z.enum(["ADMIN", "MEMBER"]),
  })
  .strict();

/**
 * `POST /organizations/:id/invitations` (Section 3). `command.organizationId`
 * comes from the path `:id` (the *claimed* target); `context.organizationId`
 * comes from `X-Organization-Id` (the caller's own resolved scope) — these
 * are deliberately independent sources. `inviteMember`'s own existing check
 * (`organizationId.value !== context.organizationId` →
 * `ForbiddenError`/403) is what rejects a mismatch; this handler adds no
 * duplicate check of its own (Section 1: no business logic in the
 * interface layer).
 */
export async function handleInviteMember(
  request: HttpRequest,
  deps: TenancyHttpDeps,
): Promise<HttpResponse> {
  try {
    const organizationId = parseUuid(request.params.id, "organizationId");
    const context = buildOrgScopedContext(request, deps.ids);
    const requestId = extractRequestId(request, deps.ids);
    const body = parseBody(inviteMemberBodySchema, request.body);
    const email = parseEmail(body.email, "email");

    const result = await inviteMember(
      context,
      {
        organizationId,
        email,
        role: body.role,
        // Never null here: `buildOrgScopedContext` always constructs a
        // "user" actor from `extractActorId`, which throws first if absent.
        invitedBy: context.actor.id!,
        requestId,
      },
      {
        uow: deps.uowFactory(context.organizationId),
        organizationRepository: deps.organizationRepository,
        invitationRepository: deps.invitationRepository,
        membershipRepository: deps.membershipRepository,
        ids: deps.ids,
        clock: deps.clock,
        invitationExpiryDays: deps.invitationExpiryDays,
      },
    );

    if (!result.ok) return mapErrorToHttpResponse(result.error);
    return { status: 201, body: result.value };
  } catch (error) {
    return mapErrorToHttpResponse(error);
  }
}
