/**
 * Context resolution (E03-T32; Architecture §20.2; ADR-0008 layer 2).
 *
 * ADR-0008's four-layer tenant isolation model requires the request
 * `Context`'s organization scope to be **server-resolved, never
 * client-asserted** — the second of the four layers, and the one that
 * makes the other three meaningful (a repository requiring an org id is
 * no protection if that id came straight from a header).
 *
 * This is deliberately narrow: authenticating *who* the actor is (session
 * cookie, API key) is the auth module's job (E06), not platform's — this
 * function's only input is an *already-authenticated* `Actor` plus the
 * organization the caller *claims* to be acting in (from a header, path
 * segment, whatever the interface binding extracts). It verifies that
 * claim against a `MembershipLookup` port before it ever becomes part of
 * a trusted `Context`. The actual HTTP wiring (extracting the claim,
 * calling this function, handling the result) is E14's job — this is the
 * framework-agnostic "spec + reference hooks" the task calls for.
 */

import {
  ForbiddenError,
  createContext,
  type Actor,
  type Context,
  type CreateContextInput,
  type IdGenerator,
  type Result,
  ok,
  err,
} from "@corestack/kernel";

export interface MembershipLookup {
  /** Is this user an active member of this organization, right now? */
  isActiveMember(userId: string, organizationId: string): Promise<boolean>;
}

export interface ResolveContextInput {
  /** Already authenticated elsewhere (auth module) — never constructed here. */
  readonly actor: Actor;
  /**
   * The organization the caller *claims* to be acting in — untrusted input
   * from a header, path segment, or query param. `null` for platform-scoped
   * requests that carry no org claim at all.
   */
  readonly claimedOrganizationId: string | null;
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly locale?: string | null;
}

/**
 * Build the kernel's `CreateContextInput` from the optional resolution
 * fields, omitting any key whose value is `undefined` — required because
 * `exactOptionalPropertyTypes` treats an explicit `undefined` differently
 * from an omitted key.
 */
function baseContextInput(
  input: ResolveContextInput,
  organizationId: string | null,
): CreateContextInput {
  return {
    actor: input.actor,
    organizationId,
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
    ...(input.locale !== undefined ? { locale: input.locale } : {}),
  };
}

/**
 * Resolve a trustworthy `Context` from an authenticated actor and a claimed
 * org, verifying membership before trusting the claim. Returns
 * `ForbiddenError` — deliberately the *same* error whether the org doesn't
 * exist or the actor simply isn't a member of it, so a forged claim can
 * never be used to distinguish "wrong org id" from "not your org"
 * (Architecture §20's isolation posture: cross-tenant access looks
 * identical to non-existence).
 */
export async function resolveContext(
  input: ResolveContextInput,
  membershipLookup: MembershipLookup,
  ids: IdGenerator,
): Promise<Result<Context, ForbiddenError>> {
  if (input.claimedOrganizationId === null) {
    return ok(createContext(baseContextInput(input, null), ids));
  }

  if (input.actor.id === null) {
    // The system actor has no membership to check against; an
    // organization-scoped claim paired with a system actor is a misuse of
    // this function (system contexts are constructed via `systemContext`
    // directly, never through a claimed-org resolution path).
    return err(
      new ForbiddenError("cannot resolve an organization-scoped context for a system actor"),
    );
  }

  const isMember = await membershipLookup.isActiveMember(
    input.actor.id,
    input.claimedOrganizationId,
  );
  if (!isMember) {
    return err(new ForbiddenError("actor is not an active member of the claimed organization"));
  }

  return ok(createContext(baseContextInput(input, input.claimedOrganizationId), ids));
}
