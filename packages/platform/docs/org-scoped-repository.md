# Component Spec — Org-Scoped Repository Base

- **Task:** E03-T31 · **Status:** Implemented · **Category:** APP (context narrowing) + ADP (Postgres query wrapper)
- **ADR references:** ADR-0008 (pooled multi-tenancy, layer 1: "Repository port signatures _require_ the org id for tenant-owned data — it is structurally impossible to call `findProjects()` without a tenant")
- **Design docs:** [Architecture §20](../../docs/architecture/ARCHITECTURE.md), [tenant-isolation.md](tenant-isolation.md) (E03-T30, layer 3 — this component is layer 1)

## Contract

**Purpose:** make it structurally impossible for a repository method to
query a tenant-owned table without an organization id — a **compile-time**
guarantee, not a runtime check repeated on every call.

**Public surface:**

| Export              | Layer                        | Purpose                                                                       |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `OrgScopedContext`  | application                  | `Context` with `organizationId` narrowed from `string \| null` to `string`    |
| `requireOrgScoped`  | application                  | The one runtime check: narrows a `Context`, throwing `ForbiddenError` if null |
| `runOrgScopedQuery` | infrastructure, `./postgres` | Runs a query inside a transaction with `app.current_org` set from the context |

## Why a type, not a runtime guard

The blueprint's acceptance criterion is explicit: **"Type error (not
runtime) when org-scoped helper called without org."** `Context.organizationId`
(kernel, `string | null`) is legitimately nullable for platform-scoped
operations — the type itself can't rule out the missing-org case. So the
missing-org case is ruled out once, at the boundary, by narrowing:

```ts
export interface OrgScopedContext extends Context {
  readonly organizationId: string;
}

export function requireOrgScoped(context: Context): OrgScopedContext {
  if (context.organizationId === null) throw new ForbiddenError(/* ... */);
  return context as OrgScopedContext;
}
```

Every org-scoped helper downstream (`runOrgScopedQuery`, and any future
repository method built on it) takes `OrgScopedContext`, never `Context`.
Passing a plain `Context` — whose `organizationId` is `string | null` — to
a function expecting `OrgScopedContext` (`organizationId: string`) is
rejected by structural typing before the code runs at all: `string | null`
is not assignable to `string`. Verified directly: temporarily removing the
`@ts-expect-error` in the type-enforcement test reproduces the exact
compiler error (`TS2345`, "Type 'string | null' is not assignable to type
'string'"), then restoring it. `requireOrgScoped` is the **only** runtime
check in this component — everything after it is enforced by the type
system, not by re-validating on every repository call.

## `runOrgScopedQuery`

Thin wrapper over `withOrgContext` (E03-T30) that takes an
`OrgScopedContext` instead of a raw string. Requiring the narrowed context
type (not a bare `organizationId: string` parameter) means a caller can
only reach this helper via `requireOrgScoped`'s one check, or by holding a
context another caller already narrowed — not by fabricating an
`organizationId` string inline, which a bare-string parameter would have
allowed.

## Fixture repository

`test/integration/fixtures/fixture-widget-repository.ts`'s
`FixtureWidgetRepository.list(context: OrgScopedContext)` is a real,
minimal repository built on these helpers — not just a type-level
exercise. Its integration test connects to the fixture table's app role
via a **genuinely separate, directly authenticated connection** (a
temporary login password granted to the scratch database's app role, not
`SET LOCAL ROLE` from a superuser session) — closing the exact gap
[tenant-isolation.md](tenant-isolation.md) documents as T30's harness
limitation ("does not prove behavior is identical for a connection
authenticated directly as the restricted role"). Two tests prove the
repository returns only the calling context's own organization's row.

## Finding: `ReservedSql.begin` is typed but doesn't exist at runtime

While designing the integration test, the original plan was `sql.reserve()`
→ `SET ROLE` on the reserved connection → `reserved.begin(...)` to run a
transaction on that same pinned connection. postgres.js's types declare
`interface ReservedSql<T> extends Sql<T>`, implying `.begin()` is
available. Verified empirically against the installed version
(`postgres@3.4.9`): `reserved.begin` is `undefined` at runtime — calling
it throws `TypeError: reserved.begin is not a function`. In the first,
unguarded attempt this produced an unhandled rejection with no output at
all (the process appeared to hang indefinitely rather than fail visibly,
since nothing awaited or logged the rejection) — worth knowing if a
similar silent-hang symptom recurs elsewhere. Abandoned that approach for
the directly-authenticated-connection design described above, which is
both simpler and closes a real gap rather than working around a library
limitation.

## Testing

**4 pure unit tests** (`test/application/org-scoped-context.test.ts`):
narrowing a non-null-org context, throwing for a null-org context,
preserving the rest of the context's fields, and including the
correlation id in the thrown error's metadata.

**1 type-level test**
(`test/application/org-scoped-context-type-enforcement.test.ts`): a
`@ts-expect-error`-annotated, never-invoked function proves
`runOrgScopedQuery` rejects a plain `Context` at compile time; a sibling
function proves an `OrgScopedContext` is accepted with no error. Covered
by the `typecheck` script (`tsc --noEmit`, which includes `test/`) — the
runtime assertion in the `it()` block only confirms both functions exist,
it never calls the type-invalid one.

**3 real-Postgres integration tests**
(`test/integration/org-scoped-repository.postgres.test.ts`): the fixture
repository, over a directly-authenticated app-role connection, returns
exactly one organization's row for a context scoped to that organization
(both directions); a third test then runs a raw query on that same pool
**outside** `runOrgScopedQuery` and asserts it fails loudly — proving
T30's fail-loud finding holds for the actual production connection shape
(directly authenticated as the app role), not only for the superuser
`SET ROLE` session T30's own tests used.

## Design rationale

Why does `OrgScopedContext` extend `Context` rather than being a separate,
unrelated interface carrying just an org id? Repository methods built on
it need the rest of `Context` too (actor, correlation id, causation id)
for the same reasons every other use case does — logging, further
event/job dispatch, audit trails. Extending `Context` means an
already-resolved, already-org-scoped context flows through exactly as it
would anywhere else in the codebase, just with one field's type narrowed.

Why not fold `requireOrgScoped` into `resolveContext` (E03-T32) so
`resolveContext` always returns an `OrgScopedContext`? `resolveContext`
must legitimately return a null-org `Context` for platform-scoped requests
(sweepers, cross-org admin operations) — that's not an error case, it's a
real, intended shape. Forcing every `resolveContext` caller to also handle
"was this actually org-scoped" would conflate two different questions
(is the actor who they claim, and does _this particular operation_ need
an org) that callers answer at different points in a request's lifecycle.
