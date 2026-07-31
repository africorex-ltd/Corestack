# E05-T13 — Tenancy HTTP Interface: Completion Report

- **Date:** 2026-07-30
- **Scope:** founder directive "Begin E05-T13 only. Do not implement
  authentication providers, background jobs, anonymous invitation
  acceptance, pagination, filtering, or search." Sections 1–15.
- **Verdict:** **Complete** — the tenancy module is now HTTP-accessible
  for six routes, exactly as scoped.

## What shipped

`packages/tenancy/src/interface/http/` — six route handlers
(`handleCreateOrganization`/`handleInviteMember`/`handleAcceptInvitation`/
`handleGetOrganization`/`handleListOrganizationMembers`/
`handleListPendingInvitations`), shared `validation.ts`/`context.ts`/
`errors.ts` helpers, transport-neutral `types.ts`, and a declarative
`routes.ts` route table — exported from a new `@corestack/tenancy/interface`
subpath, filling in the E05-T01 reserved `src/interface/` barrel.

Full design writeup:
[docs/modules/tenancy-http-interface.md](../modules/tenancy-http-interface.md)
(route table, validation rules, error mapping, the 404-vs-403 rationale,
serialization rules, the future pagination note).

**Tests:** 73 new tests total — 59 unit tests (`test/interface/http/`:
`validation.ts`/`context.ts`/`errors.ts` helper tests, one test file per
route handler against the in-memory reference repositories, a route-table
shape test, and the export-surface snapshot's new `./interface` block)
and 14 new integration tests appended to
`test/integration/tenancy-postgres.postgres.test.ts`'s new `"Tenancy HTTP
interface (E05-T13)"` describe block, run against real PostgreSQL:
successful create/invite/accept, successful reads, a validation failure,
duplicate conflicts, an authorization failure, and — the property that
actually requires a real database — genuine RLS-backed cross-tenant
invisibility for all three `GET` routes.

## No new repository method, use case, or query — again

Exactly like T12's own headline finding, this task needed zero changes to
anything below the interface layer. Every route calls
`createOrganization`/`inviteMember`/`acceptInvitation`/`getOrganization`/
`listOrganizationMembers`/`listPendingInvitations` unchanged. The entire
task was: parse a request, build a context, call an existing function,
map the result (or a thrown error) to an HTTP response.

## Why there is no framework — and why that's not a workaround

Confirmed by search before writing any code: no HTTP framework, no
router, no `interface/` layer of any kind exists anywhere else in this
monorepo. `docs/architecture/ARCHITECTURE.md` §10 names Hono as the
eventual reference binding, but it isn't installed, and the documented
plan (`docs/engineering/02-identity.md`'s `E05-T24`/`E05-T25` entries)
makes Tenancy's HTTP layer depend on a not-yet-built shared toolkit
(`@corestack/http`, epic E14). This task's founder directive supersedes
that sequencing deliberately — Section 14 explicitly asks for routes,
validation, and error mapping *without* a controller framework,
middleware abstractions, or a DI container, and Section 2 caps scope at
"not... a full web server bootstrap beyond what is needed for tests."

The resolution mirrors `packages/platform`'s own precedent for the
identical situation (`docs/platform/health-contract.md`'s "ship pure
computation, not a router" scope note): every handler is a plain `async`
function with one `try`/`catch`, and `tenancyRoutes` is declarative
`{method, path, handler}` metadata — nothing in this package matches a
path or dispatches a request. A future binding (Hono, when it exists)
would iterate this table and register each entry with its own router.

## The header-based context design, and the anti-pattern it avoids

`context.organizationId` always comes from an `X-Organization-Id`
header — **never** the URL path, even on the four routes whose path also
names an organization. The first design considered (path segment directly
becomes `context.organizationId`) was rejected mid-design: it is exactly
the anti-pattern `docs/security/how-to-build-a-tenant-safe-feature.md`
step 1 warns against ("never trust a client-claimed `organizationId`
directly") — it would let any caller type a different `:id` into the URL
and transparently scope their own transaction to a different tenant, with
no real isolation boundary at all.

The corrected design treats the header as the caller's authenticated
scope (a deliberate stand-in for a real authentication provider, which
Section 1 explicitly excludes building) and the path segment as a
*claim* or *target*, checked against that scope by whichever mechanism
already exists:

- `POST /organizations/:id/invitations`: the path becomes
  `command.organizationId`; `inviteMember`'s own pre-existing check
  (`organizationId.value !== context.organizationId` → `ForbiddenError`)
  rejects a mismatch. No new code needed — this use case already had the
  exact check this design requires.
- `GET /organizations/:id`: `getOrganization`'s T12 signature already
  takes context *and* a separate target id. RLS (or, in-memory, the
  query's own context check) decides visibility.
- `GET /organizations/:id/members`/`.../invitations`: neither underlying
  query has an independent target parameter. Without a fix, the path
  `:id` would be silently ignored — a caller whose header names org A
  but whose URL names org B would receive **org A's** data while the URL
  claims org B's. The fix: call `getOrganization(context, pathId, ...)`
  as an explicit pre-check before the list query; a `null` result is a
  404 before the list query ever runs.

## A real gap the advisor caught before commit

The first draft of the in-memory unit tests for these two list routes
asserted a genuine cross-tenant 404. That assertion **failed**:
`InMemoryOrganizationRepository.findById` ignores `context` entirely (an
established, documented limitation since E05-T11 — the in-memory
repository has no RLS to emulate), so the `getOrganization` pre-check
these two routes rely on always succeeds in-memory regardless of whether
the header and path actually match. The fix was not a code change — the
production behavior against real Postgres is correct, proven by the
integration suite — but a test-scope correction: the three in-memory
cross-tenant tests were replaced with a comment explaining exactly why
that property isn't representable at that level, and the genuine proof
was written into the Postgres integration suite instead, mirroring
exactly how T11/T12 handled the same limitation for their own repository
and query-layer RLS tests.

## Two smaller findings from a second advisor pass, fixed before commit

- `requireNonEmptyString` (`validation.ts`) was written, exported, and unit
  tested, but no route handler ever called it — every body field either
  goes through Zod (`parseBody`) or a dedicated helper (`parseUuid`,
  `parseEmail`). An advisor review flagged it as public surface with no
  consumer, exactly what the export-surface snapshot exists to catch.
  Removed (function, export, and its three unit tests) rather than kept
  as speculative surface — consistent with Section 14's "keep the
  interface explicit," not "keep everything that might be useful later."
- `context.actor.id ?? ""` in the three write-route handlers
  (`create-organization-route.ts`, `invite-member-route.ts`,
  `accept-invitation-route.ts`) silently coerced a hypothetical `null`
  actor id to an empty string before passing it to `requestedBy`/
  `invitedBy`/`userId`. `Actor.id` is `string | null` at the kernel type
  level, but `buildContext`/`buildOrgScopedContext` (this package's own
  code) only ever construct a `"user"` actor from `extractActorId`, which
  already throws a `ValidationError` before that point if the header is
  missing — so the `null` case is unreachable in practice, and silently
  substituting `""` would have masked that invariant breaking rather than
  surfacing it loudly. Replaced with a non-null assertion (`!`) plus a
  one-line comment stating the invariant it relies on.

## Error mapping: one table, already correct for every existing error

`mapErrorToHttpResponse` switches on the five base kernel error classes
(`ValidationError`/`NotFoundError`/`ConflictError`/`ForbiddenError`/
`UnauthorizedError`) rather than enumerating each of the eight
tenancy-specific error classes individually — every one of them already
extends one of these five (E05-T03/T05/T06/T07), so the table needed no
tenancy-specific entries and stays correct if a future task adds another
subclass of an existing kernel error. One documented consequence: the
invite route's `role` field is restricted to `z.enum(["ADMIN", "MEMBER"])`
at the interface layer, which makes `CannotInviteOwnerError` unreachable
via HTTP — it remains reachable, and tested, for any direct non-HTTP
caller of `inviteMember`. The design doc's error-mapping table flags this
row explicitly rather than leaving an unreachable-looking entry
unexplained.

## The trust boundary this task does not close

`POST /invitations/:id/accept` has no organization id anywhere in its
path — `acceptInvitation`'s own command has no `organizationId` field.
`context.organizationId` comes from `X-Organization-Id`; `userId` comes
from `X-Actor-Id` (never the body — an actor cannot claim to be someone
else); but `email` comes from the request body, the claim
`acceptInvitation` checks against `invitation.email`. Without a real
authentication provider, nothing verifies that body-supplied email
belongs to the caller. `docs/modules/accept-invitation-usecase.md`
already documented this exact gap for the use case itself; this route
inherits it unchanged. Closing it requires a real authentication
provider, which Section 1 of this task's own founder directive
explicitly excludes building.

## Quality gate

All green, repo-wide:

- `pnpm -r build` / `pnpm -r typecheck` (via `turbo run build typecheck`)
  — 8/8 tasks pass.
- `eslint packages/tenancy` — zero findings, checked after every source
  change.
- `pnpm -r test` (via `turbo run test`) — 8/8 tasks pass, including
  tenancy's full 450-test unit suite (up from 391).
- `pnpm --filter @corestack/tenancy test:integration` — 34/34 tests pass
  (up from 20) against a real local PostgreSQL 18.4 instance, run twice
  to confirm stability; scratch-database cleanup verified.
- Architecture-fitness suite — unchanged at 36 tests across 5 files (no
  new package/manifest surface).
- Export-surface snapshot — updated for the new `./interface` subpath
  (17 exports: 6 handlers, `tenancyRoutes`, `mapErrorToHttpResponse`, 5
  context helpers, 4 validation helpers); no unexpected exports. An
  initial fifth validation helper, `requireNonEmptyString`, was exported
  but never called by any route handler — dropped before commit rather
  than shipped as unused public surface (Section 14: keep the interface
  layer thin).

## Permanent policy reaffirmed (Section 11)

Handlers are orchestration only; validation at the edge; business rules
in the application services; DTOs across the wire; RLS determines
visibility — all five describe exactly what this task built.

## Stale references corrected in passing

Two pre-existing comments (`module.ts`'s purge-handler error message,
this package's own `README.md`) predicted "real deletion logic ships in
E05-T13" — a guess made back in E05-T01, before the founder directive
sequence assigned T13 to the HTTP interface layer instead. Both were
corrected to say "a future task," not re-guessed at a specific number.

## What's still open, not resolved here

- **Authentication providers, background jobs, anonymous invitation
  acceptance, pagination, filtering, search** — all explicitly out of
  scope per Section 1.
- **A real HTTP binding.** `tenancyRoutes` is declarative metadata only;
  no framework registers it, no socket listens. A future task would add
  a real binding (Hono, per `ARCHITECTURE.md` §10).
- **The accept-invitation trust boundary**, documented above — requires
  a real authentication provider to close, not attempted here.
- **Full RFC 9457 `problem+json`, 422 status codes, pagination
  envelopes, URL versioning** — all documented, deliberate divergences
  from the future full API standard (E14's eventual scope), not
  omissions.
- **Release-pipeline debt** (recurring, tracked across every prior
  report in this sequence): `@corestack/tenancy` remains `0.0.1`, no
  changeset — this task adds a new public export condition
  (`./interface`); still not cut into a release.

## Next

**E05-T14**: not yet specified by the founder directive sequence. Not
started. Per Section 15, work stops here pending the next prompt — no
background job or notification-delivery work started automatically.
