/**
 * Org-scoped context narrowing (E03-T31; ADR-0008 layer 1: "Repository
 * port signatures _require_ the org id for tenant-owned data — it is
 * structurally impossible to call `findProjects()` without a tenant").
 *
 * `Context.organizationId` is `string | null` — legitimately null for
 * platform-scoped operations (E03-T32's `resolveContext`). Every
 * org-scoped repository helper in this package requires `OrgScopedContext`
 * instead, whose `organizationId` is a plain `string`. Passing a bare
 * `Context` where `OrgScopedContext` is expected is a **type error**, not
 * a runtime check — `string | null` is not assignable to `string` — so a
 * caller cannot reach a tenant-scoped query without first narrowing
 * through `requireOrgScoped` (or already holding a context it produced).
 */
import { ForbiddenError, type Context } from "@corestack/kernel";

export interface OrgScopedContext extends Context {
  readonly organizationId: string;
}

/**
 * The one runtime check in this module: narrows a `Context` whose
 * `organizationId` might be `null` into one where it provably isn't.
 * Everything downstream of this call is enforced at the type level, not
 * by repeating this check — that's the point of narrowing once at the
 * boundary rather than validating on every repository call.
 */
export function requireOrgScoped(context: Context): OrgScopedContext {
  if (context.organizationId === null) {
    throw new ForbiddenError("this operation requires an organization-scoped context", {
      metadata: { correlationId: context.correlationId },
    });
  }
  return context as OrgScopedContext;
}
