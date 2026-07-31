import { z } from "zod";

import { acceptInvitation } from "../../application/accept-invitation.js";
import { buildOrgScopedContext, extractRequestId } from "./context.js";
import { mapErrorToHttpResponse } from "./errors.js";
import { parseBody, parseEmail, parseUuid } from "./validation.js";
import type { HttpRequest, HttpResponse, TenancyHttpDeps } from "./types.js";

const acceptInvitationBodySchema = z
  .object({
    email: z.string().trim().min(1),
  })
  .strict();

/**
 * `POST /invitations/:id/accept` (Section 3). The one route with **no**
 * organization id anywhere in its path — `context.organizationId` comes
 * entirely from `X-Organization-Id` (the same header every other
 * org-scoped route uses), because `acceptInvitation`'s own command has no
 * `organizationId` field at all (see `accept-invitation.ts`'s doc
 * comment: "an org-scoped repository returning a row is itself the
 * tenant-isolation guarantee").
 *
 * **Sharpest trust-boundary limitation in this interface** (see
 * docs/modules/tenancy-http-interface.md's dedicated section): `userId`
 * comes from `X-Actor-Id` (never the body — an actor cannot claim to be
 * someone else), but `email` comes from the **request body** — the claim
 * being checked against `invitation.email` inside `acceptInvitation`
 * itself. Without a real authentication provider (explicitly out of
 * scope for this task), nothing here verifies that `email` genuinely
 * belongs to the caller identified by `X-Actor-Id`; the security of this
 * route rests entirely on `acceptInvitation`'s own email-equality check,
 * which in turn rests entirely on the caller supplying a truthful email.
 * `docs/modules/accept-invitation-usecase.md` already documents this gap
 * for the use case itself; this route inherits it unchanged, it does not
 * close it.
 */
export async function handleAcceptInvitation(
  request: HttpRequest,
  deps: TenancyHttpDeps,
): Promise<HttpResponse> {
  try {
    const invitationId = parseUuid(request.params.id, "invitationId");
    const context = buildOrgScopedContext(request, deps.ids);
    const requestId = extractRequestId(request, deps.ids);
    const body = parseBody(acceptInvitationBodySchema, request.body);
    const email = parseEmail(body.email, "email");

    const result = await acceptInvitation(
      context,
      {
        invitationId,
        // Never null here: `buildOrgScopedContext` always constructs a
        // "user" actor from `extractActorId`, which throws first if absent.
        userId: context.actor.id!,
        email,
        requestId,
      },
      {
        uow: deps.uowFactory(context.organizationId),
        invitationRepository: deps.invitationRepository,
        membershipRepository: deps.membershipRepository,
        ids: deps.ids,
        clock: deps.clock,
      },
    );

    if (!result.ok) return mapErrorToHttpResponse(result.error);
    return { status: 200, body: result.value };
  } catch (error) {
    return mapErrorToHttpResponse(error);
  }
}
