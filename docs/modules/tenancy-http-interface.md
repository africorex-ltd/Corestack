# Tenancy HTTP Interface (E05-T13)

- **Status:** a thin HTTP adaptation layer over the existing application
  use cases (E05-T03/T06/T07) and query services (E05-T12) — six routes,
  no new business logic. No authentication providers, no background
  jobs, no anonymous invitation acceptance, no pagination, no filtering,
  no search (explicitly out of scope per Sections 1/14 of the founder
  directive).
- **Scope:** `packages/tenancy/src/interface/http/` — `types.ts`
  (transport-neutral `HttpRequest`/`HttpResponse`/`RouteDefinition`/
  `TenancyHttpDeps`), `validation.ts`, `context.ts`, `errors.ts`, six
  `*-route.ts` handler files, `routes.ts` (the route table), and the
  package's new `./interface` subpath export
  (`src/interface/index.ts`, filling in the E05-T01 reserved barrel).
- **Builds on:** [tenancy-query-services.md](tenancy-query-services.md)
  (E05-T12) and [tenancy-postgres-adapters.md](tenancy-postgres-adapters.md)
  (E05-T11) — every route calls an existing use case or query function
  unchanged; **no new repository method, no new use case, and no new
  query was added for this task** (Section 2: "use the existing
  application/query services only").

## Why there is no framework, no matcher, and no server bootstrap

No HTTP framework exists anywhere in this monorepo yet — confirmed by
search before writing any code. `docs/architecture/ARCHITECTURE.md` §10
names Hono as the eventual reference binding, but it is not installed,
and the documented plan (`docs/engineering/02-identity.md`'s
`E05-T24`/`E05-T25` entries) makes Tenancy's HTTP layer depend on a
not-yet-built shared toolkit (`@corestack/http`, epic E14: route-def
format, Zod validation pipeline, problem-details mapper, CSRF, rate
limiting). This task's founder directive supersedes that sequencing for
now — Section 14 explicitly asks for routes, validation, and error
mapping *without* "a controller framework," "middleware abstractions,"
or "a dependency injection container," and Section 2 caps scope at "not
... a full web server bootstrap beyond what is needed for tests."

The resolution mirrors `packages/platform`'s own precedent for the
identical situation (`docs/platform/health-contract.md`'s "ship pure
computation, not a router" scope note, written when `packages/platform`
first needed HTTP-adjacent behavior with no framework available): every
route handler here is a plain `async` function,
`(request: HttpRequest, deps: TenancyHttpDeps) => Promise<HttpResponse>`,
with one `try`/`catch` and no other control-flow abstraction.
`tenancyRoutes` (`routes.ts`) is declarative metadata — `{method, path,
handler}` triples — that a real binding (Hono, when it exists) would
iterate and register with its own router; **this package matches no
path and dispatches no request itself**. Every test in this package
(unit and integration) calls a `handle*` function directly with a
hand-built `HttpRequest`, never through a router.

## Route table

| Method | Path | Handler | Underlying service |
|---|---|---|---|
| `POST` | `/organizations` | `handleCreateOrganization` | `createOrganization` (E05-T03) |
| `POST` | `/organizations/:id/invitations` | `handleInviteMember` | `inviteMember` (E05-T06/T07) |
| `POST` | `/invitations/:id/accept` | `handleAcceptInvitation` | `acceptInvitation` (E05-T07) |
| `GET` | `/organizations/:id` | `handleGetOrganization` | `getOrganization` (E05-T12) |
| `GET` | `/organizations/:id/members` | `handleListOrganizationMembers` | `getOrganization` (pre-check) + `listOrganizationMembers` (E05-T12) |
| `GET` | `/organizations/:id/invitations` | `handleListPendingInvitations` | `getOrganization` (pre-check) + `listPendingInvitations` (E05-T12) |

**Deliberately no `/v1` prefix.** `docs/architecture/ARCHITECTURE.md` §26
documents URL-major versioning as the eventual convention; this task's
Section 3 specifies these exact paths, and adding a version segment
nobody asked for would be scope creep, not fidelity to the directive.

## Context extraction

Section 5: "Extract: organization id, actor id, request id. Build the
existing `OrgScopedContext`. Do not add new context types." Three
headers, extracted uniformly on every route that needs them
(`context.ts`):

| Header | Populates | Required on |
|---|---|---|
| `X-Actor-Id` | `context.actor.id` | all six routes |
| `X-Organization-Id` | `context.organizationId` | every route except `POST /organizations` |
| `X-Request-Id` | `context.correlationId` / `command.requestId` | all six routes (generated if absent) |

**`X-Actor-Id` and `X-Organization-Id` are a deliberate, documented
stand-in for a real authentication provider** — Section 1 of this task's
founder directive explicitly excludes implementing one. A real binding
would derive both from an authenticated session/JWT, never from a raw
header a client can set arbitrarily; until that exists, these headers
are the load-bearing trust boundary this interface layer sits behind.
Both are validated as UUID-shaped on every route (`parseUuid`,
`validation.ts`) — including `X-Actor-Id` on `POST /organizations`, whose
own `createOrganization` command does not itself enforce UUID shape on
`requestedBy`. This is a slightly stricter contract than the bare use
case requires, chosen for uniformity across all six routes and because a
malformed actor id must never reach a repository's `::uuid` cast
unchecked (see "Error mapping" below).

**`context.organizationId` never comes from the URL path** — even on the
four routes whose path also names an organization
(`docs/security/how-to-build-a-tenant-safe-feature.md` step 1: "never
trust a client-claimed `organizationId` directly"). A path segment
naming an organization is a *claim* or a *target*, checked against
`X-Organization-Id` either by the use case itself (`inviteMember`'s own
existing `ForbiddenError` on mismatch) or by RLS (`getOrganization`'s
mirrored target/context shape, E05-T12) — never used to *construct*
`context.organizationId`. See "404 vs 403" below for why this matters.

## Validation rules

Section 4's four bullets, each owned by a specific layer:

- **Body shape**: every `POST` route's body is validated by a `zod`
  schema with `.strict()` (unknown fields rejected) via `parseBody`
  (`validation.ts`), which bridges `ZodError` into the kernel's
  `ValidationError` (ADR-0005: "validation failures surface as the
  kernel's `ValidationError`... they never throw raw Zod errors across
  layer boundaries").
- **UUID parameters**: path `:id` segments and the `X-Actor-Id`/
  `X-Organization-Id` headers are validated against the same UUID
  pattern `domain/organization-id.ts`'s own `UUID_PATTERN` uses
  (re-declared in `validation.ts`, not imported from the domain layer —
  a boundary check is a different concern from a domain invariant, and
  duplicating one small, stable regex is cheaper than the wrong-direction
  coupling).
- **Email format**: `parseEmail` mirrors `domain/email.ts`'s own
  `EMAIL_PATTERN` (trim, lowercase, then match) for the same reason.
- **Role values**: `POST /organizations/:id/invitations`'s body schema
  restricts `role` to `z.enum(["ADMIN", "MEMBER"])` — the two legal
  `InvitationRole` values. **Consequence**: an `"OWNER"` request is
  rejected here, at the interface layer (400, generic Zod-shaped
  message), one layer before it would reach `inviteMember`'s own
  dedicated `CannotInviteOwnerError`. That error type is not dead code —
  it remains reachable (and is still tested) for any non-HTTP caller of
  `inviteMember` directly — it is simply not observable through this
  route. See the error-mapping table below, which flags this row
  explicitly rather than leaving an unreachable-looking entry
  unexplained.

## Error mapping

Section 6: "Map domain/application errors to HTTP status codes. Document
the mapping. Do not leak raw error messages from infrastructure." One
function, `mapErrorToHttpResponse` (`errors.ts`), derives status from the
kernel `CoreError` subclass:

| Kernel error | HTTP status |
|---|---|
| `ValidationError` | 400 |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `ForbiddenError` | 403 |
| `UnauthorizedError` | 401 |
| anything else (raw infra error, a bug) | 500, generic body |

Every tenancy-specific error class already extends one of the first five
(E05-T03/T05/T06/T07) — this table needs no per-class entry and stays
correct if a future task adds another subclass of an existing kernel
error:

| Tenancy error | Kernel parent | HTTP status | Reachable via HTTP? |
|---|---|---|---|
| `DuplicateSlugError` | `ConflictError` | 409 | yes (`POST /organizations`) |
| `CannotInviteOwnerError` | `ValidationError` | 400 | **no** — pre-empted by the `role` enum, see "Validation rules" above |
| `InvitationAlreadyExistsError` | `ConflictError` | 409 | yes (`POST /organizations/:id/invitations`) |
| `InviterNotAuthorizedError` | `ForbiddenError` | 403 | yes (`POST /organizations/:id/invitations`) |
| `InvitationNotFoundError` | `NotFoundError` | 404 | yes (`POST /invitations/:id/accept`) |
| `InvitationNotPendingError` | `ConflictError` | 409 | yes (`POST /invitations/:id/accept`) |
| `InvitationExpiredError` | `ConflictError` | 409 | yes (`POST /invitations/:id/accept`) |
| `MembershipAlreadyExistsError` | `ConflictError` | 409 | yes (`POST /invitations/:id/accept`) |

The response body for every expected error is `{code, message,
metadata}` — `.message` is already a hand-written, business-safe string
for every one of these classes (never a raw driver/infrastructure
message), and `.metadata` only ever contains values the caller already
supplied in their own request, so echoing it back is not a leak. The
500 branch never reads `error.message`/`.stack` — its body is the fixed
constant `{code: "core/internal", message: "an unexpected error
occurred"}`, regardless of what was actually thrown; a real deployment
is expected to log the raw `error` value out of band, separately from
this response.

### Divergences from the future API standard

`docs/architecture/API.md` §19–22 and `ARCHITECTURE.md` §26 document a
fuller standard for CoreStack's eventual HTTP surface. This task
deliberately implements a narrower subset, each divergence intentional
and scoped to what Sections 4/6/7 of this task's founder directive
actually ask for:

| This task | Future standard | Why |
|---|---|---|
| 400 for validation failures | 422 | Section 4 explicitly specifies 400; E14 owns the full status-derivation table |
| `{code, message, metadata}` | RFC 9457 `application/problem+json` | Section 6 asks for status-code mapping and documentation, not a specific wire format; E14 owns `problem+json` |
| bare arrays for list responses | `{data: [...], pagination: {...}}` | Section 14 forbids pagination this task; an envelope built around a nonexistent concept would be premature |
| no `/v1` prefix | URL-major versioning | Section 3 specifies exact paths; versioning is an API-gateway/E14 concern |

## 404 vs 403 (Section 8)

**"For GET routes: return 404 when the organization is not visible; do
not return 403 for cross-tenant reads."** Two different mechanisms
produce this, depending on whether the underlying query has an
independent "target" concept:

- **`GET /organizations/:id`** relies entirely on RLS, with no
  interface-layer comparison of its own. `getOrganization`'s signature
  (E05-T12) deliberately mirrors `OrganizationRepository.findById`'s
  shape — `context` (from `X-Organization-Id`) plus a separate target id
  (the path `:id`). If they name different organizations, the query's
  `WHERE id = $target` intersected with RLS's `id =
  current_setting('app.current_org')` returns zero rows, and
  `getOrganization` returns `null` — indistinguishable from the
  organization simply not existing. This is real Postgres RLS, proven
  against a live database in the integration suite (not merely asserted
  in-memory — see "Testing" below).
- **`GET /organizations/:id/members`** and **`GET
  /organizations/:id/invitations`** call `listOrganizationMembers`/
  `listPendingInvitations` (E05-T12), neither of which has an
  independent target parameter (E05-T12 deliberately did not add one).
  Without a pre-check, the path `:id` would be ignored entirely — a
  caller whose `X-Organization-Id` names org A but whose URL names org B
  would silently receive **org A's** members while the URL claims org
  B's. The fix: both handlers call `getOrganization(context,
  pathOrganizationId, ...)` *first*. If it returns `null` — either the
  path organization doesn't exist, or (via the same RLS mechanism above)
  it isn't the one `context` is scoped to — the handler responds 404
  *before* calling the list query at all. This reuses `getOrganization`
  unchanged (Section 2); it is not a new authorization check invented
  for this route, it is the only way to make the path parameter
  load-bearing given the list queries' existing shape.

Neither mechanism ever produces 403 for a cross-tenant GET — 403 is
reserved for `ForbiddenError` (an authorization failure the underlying
use case detected, e.g. `InviterNotAuthorizedError` on the invite route,
or an `inviteMember` `organizationId`-mismatch), never for "this
resource belongs to someone else."

## Response shapes and serialization

Section 7: "Return DTOs only. Do not serialize aggregates. Use stable
JSON field names." Every success response body is one of the DTOs
E05-T03/T06/T07/T12 already defined
(`CreateOrganizationResult`/`InviteMemberResult`/
`AcceptInvitationResult`/`OrganizationSummary`/
`OrganizationMemberSummary[]`/`PendingInvitationSummary[]`) — never an
`Organization`/`Membership`/`Invitation` aggregate. Status codes:

- `201` + the DTO body for `POST /organizations` and `POST
  /organizations/:id/invitations` — both literally create the resource
  the URL names.
- `200` + the DTO body for `POST /invitations/:id/accept` — an *action*
  on an existing resource (accepting), not a creation at a new,
  discoverable URI (no `GET /memberships/:id` route exists for this task
  to `Location`-point at).
- `200` + the DTO (or DTO array) for all three `GET` routes; `404` with
  `{code: "core/not_found", message: "organization not found"}` when the
  target organization is not visible.

`Date` fields (`createdAt`, `updatedAt`, `expiresAt`, `joinedAt`) stay as
native `Date` instances in the returned `HttpResponse.body` — no manual
`.toISOString()` conversion happens in this layer. `JSON.stringify`
converts a `Date` to an ISO 8601 UTC string via `Date.prototype.toJSON`
automatically; a real binding's final serialization step (`JSON.stringify`
or equivalent) produces the correct wire format with no additional code
here.

## The sharpest trust-boundary limitation: `POST /invitations/:id/accept`

This route has no organization id anywhere in its path —
`acceptInvitation`'s own command has no `organizationId` field at all
(`accept-invitation.ts`: "an org-scoped repository returning a row is
itself the tenant-isolation guarantee"). `context.organizationId` comes
entirely from `X-Organization-Id`; `userId` comes from `X-Actor-Id`
(never the body — an actor cannot claim to be someone else); but
**`email` comes from the request body** — the claim
`acceptInvitation` checks against `invitation.email`.

Without a real authentication provider (explicitly out of scope for this
task), nothing verifies that the body-supplied `email` genuinely belongs
to the caller identified by `X-Actor-Id`. The security of this entire
route rests on `acceptInvitation`'s own email-equality check, which in
turn rests on the caller supplying a truthful email.
`docs/modules/accept-invitation-usecase.md` already documents this gap
for the use case itself ("a future HTTP handler must supply an
already-verified email"); this route inherits it unchanged — it does not
close it, and closing it requires a real authentication provider, which
this task is explicitly not building.

## Future pagination note

**Not implemented (Section 14: "do not implement... pagination,
filtering, or search").** Both list routes (`GET
/organizations/:id/members`, `GET /organizations/:id/invitations`)
return every matching row in one response, as a bare JSON array — the
same simplification `tenancy-query-services.md`'s own "Future pagination
note" already documents for the underlying query services. If pagination
is added later, the natural seam is the same one that doc identifies:
extend the query's own parameter/return shape first (a `{limit,
cursor}` request and a `{items, nextCursor}` response), then thread that
shape through these two route handlers and wrap the response body in an
envelope (`{data, pagination}`, matching `ARCHITECTURE.md` §26's eventual
convention) — no repository change is implied unless row counts
genuinely demand a real `LIMIT`/keyset method.

## Permanent policy reaffirmed (Section 11)

Handlers are orchestration only (one `try`/`catch`, zero domain rules);
validation happens at the edge (`validation.ts`, before any use case
runs); business rules live in the application services (unchanged from
E05-T03..T12); every wire boundary carries a DTO, never an aggregate; RLS
determines visibility (404-vs-403, above) — all five describe exactly
what this task built.

## Testing

Two layers, matching the pattern every prior tenancy task established:

- **Unit tests** (`test/interface/http/*.test.ts`) — `validation.ts`/
  `context.ts`/`errors.ts` exercised directly, plus one test file per
  route handler against the in-memory reference repositories
  (`test-support/`). **Cross-tenant invisibility is not representable at
  this level**: `InMemoryOrganizationRepository.findById` ignores
  `context` entirely (documented since E05-T11 — it has no RLS to
  emulate), so the `getOrganization` pre-check these route handlers rely
  on cannot produce a genuine 404-vs-200-with-wrong-org distinction
  in-memory. Every such test is annotated with a comment explaining why
  it lives in the integration suite instead, not silently omitted.
- **Integration tests** (`test/integration/tenancy-postgres.postgres.test.ts`,
  new `"Tenancy HTTP interface (E05-T13)"` describe block, reusing the
  existing dual-mode Postgres harness per Section 9's explicit
  instruction) — successful create/invite/accept, successful reads,
  validation failures, duplicate conflicts, an authorization failure
  (`InviterNotAuthorizedError` → 403), and — the property that actually
  requires a real database — cross-tenant invisibility for all three
  `GET` routes, proven against genuine PostgreSQL RLS: two organizations
  seeded, a caller scoped to one requests the other's resource by path
  id, and the response is 404, never 403, never a silent wrong-org
  payload.
