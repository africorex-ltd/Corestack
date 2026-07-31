import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@corestack/kernel";

import type { HttpResponse } from "./types.js";

/**
 * Generic, fixed body for anything that isn't one of the kernel's
 * expected-failure types (Section 6: "do not leak raw error messages
 * from infrastructure") — a raw Postgres error, a bug, anything
 * un-translated. `error.message`/`.stack` are never read here; the
 * caller (a real deployment) is expected to log the raw `error` value
 * separately, out of band from this response body.
 */
const INTERNAL_ERROR_BODY = { code: "core/internal", message: "an unexpected error occurred" };

/**
 * Maps a thrown error to an `HttpResponse` (Section 6). One table, one
 * place — matching `packages/kernel/src/errors.ts`'s own stated intent
 * ("interface layers map codes to transport responses... in one place").
 *
 * **Status derivation** (Section 4/6 of this task's founder directive;
 * simplified from the fuller table `docs/architecture/ARCHITECTURE.md`
 * §26 / `docs/architecture/API.md` §21 document for a future, full
 * `@corestack/http` package — see tenancy-http-interface.md's
 * "Divergences from the future API standard" section for why 400/plain
 * JSON is used here instead of 422/RFC 9457 `problem+json`):
 *
 * | Kernel error       | HTTP status |
 * |--------------------|-------------|
 * | `ValidationError`  | 400         |
 * | `NotFoundError`     | 404         |
 * | `ConflictError`     | 409         |
 * | `ForbiddenError`    | 403         |
 * | `UnauthorizedError` | 401         |
 * | anything else       | 500 (generic body, no leak) |
 *
 * Every tenancy-specific error class (`DuplicateSlugError`,
 * `CannotInviteOwnerError`, `InvitationAlreadyExistsError`,
 * `InviterNotAuthorizedError`, `InvitationNotFoundError`,
 * `InvitationNotPendingError`, `InvitationExpiredError`,
 * `MembershipAlreadyExistsError`) already extends one of these five
 * kernel classes (E05-T03/T05/T06/T07) — this function needs no
 * per-tenancy-error-class entry, and stays correct if a future task adds
 * another subclass of an existing kernel error.
 *
 * The response body is `{code, message, metadata}` for every kernel
 * error — `.message` is already a business-safe, hand-written string for
 * every one of these classes (never a raw driver/infrastructure message),
 * and `.metadata` only ever contains values the caller already supplied
 * in their own request (organizationId, slug, email, ...), so echoing it
 * back is not a leak.
 */
export function mapErrorToHttpResponse(error: unknown): HttpResponse {
  if (error instanceof ValidationError) {
    return { status: 400, body: { code: error.code, message: error.message, metadata: error.metadata } };
  }
  if (error instanceof NotFoundError) {
    return { status: 404, body: { code: error.code, message: error.message, metadata: error.metadata } };
  }
  if (error instanceof ConflictError) {
    return { status: 409, body: { code: error.code, message: error.message, metadata: error.metadata } };
  }
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { code: error.code, message: error.message, metadata: error.metadata } };
  }
  if (error instanceof UnauthorizedError) {
    return { status: 401, body: { code: error.code, message: error.message, metadata: error.metadata } };
  }
  return { status: 500, body: INTERNAL_ERROR_BODY };
}
