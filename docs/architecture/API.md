# CoreStack — API Design Document

- **Status:** Draft, awaiting founder approval
- **Version:** 0.1
- **Date:** 2026-07-28
- **Depends on:** [Architecture](ARCHITECTURE.md) §16–18, §25–28; [Database Design](DATABASE.md); [Vision](../product/VISION.md)
- **Scope:** the complete HTTP API surface exposed by CoreStack's interface
  bindings, plus the standards every endpoint obeys. Descriptive design only.

**Reading conventions.** Endpoints are listed as `VERB /path` — required
permission — behavior notes. All paths are shown relative to the adopter's
configured mount point (default `/v1`, §18). `⚿` = requires authentication;
`⚿⚿` = additionally requires a specific permission (shown); `○` = public
(unauthenticated by design). Request/response field naming, errors, pagination
etc. are governed once in §17–§23 and not repeated per endpoint.

---

## 1. REST API — Overall Shape

**Decision recap (Architecture §26): the core API is REST, resource-oriented,
JSON-only.** Principles that shape every section below:

1. **The API is a projection of use cases, not of tables.** Each endpoint maps
   to exactly one application-layer use case; nothing reaches the database
   except through that use case. Consequently the API can never express an
   operation the platform doesn't authorize, audit, and validate.
2. **Org scope is explicit in the path** (`/organizations/{orgId}/…`) for every
   tenant-scoped resource. _Why:_ auditability (the tenant is visible in every
   access log line), cacheability, and zero ambiguity about which tenant a
   request touches. The server _verifies_ the caller's membership in `{orgId}`;
   it never infers tenant from the body.
3. **Commands that aren't CRUD are verbs under the resource**
   (`POST …/sessions/{id}/revoke`, `POST …/subscription/cancel`). _Why:_
   pretending every business operation is a PATCH produces mystery-field
   protocols; named commands keep the API self-documenting and map 1:1 to use
   cases and permissions.
4. **Stability tiers:** every endpoint is tagged `stable | preview | internal`
   in OpenAPI (`x-stability`). Semver guarantees apply to `stable` only;
   `preview` may change with a changelog note; `internal` (admin/support) may
   change any time.

## 2. GraphQL API

**Decision (unchanged from Architecture §27): no GraphQL in core.** Restated
here as an API-design position: the surface below is command-heavy — GraphQL's
strengths (client-shaped reads over deep graphs) buy little, while its costs
(per-field authorization, query complexity limits, resolver N+1 discipline)
duplicate the security-critical machinery REST already carries.

What this document guarantees instead, so the door stays open:

- Use cases are transport-agnostic; a community GraphQL binding can wrap them
  without forking (resolvers → use cases, same `Context`, same permissions).
- The OpenAPI spec (§24) is complete enough to mechanically derive a schema
  skeleton for such a binding.
- If adopter demand proves out, GraphQL-in-core returns as a vision-level ADR,
  not a drive-by feature.

## 3. Authentication Endpoints (`auth` module)

Session flows (browser-first; cookie-based, §19):

| Endpoint                                   | Access    | Notes                                                                                                                                                                  |
| ------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register`                      | ○         | email + password (+ invitation token optional). Always `202` with neutral body — no user enumeration. Triggers verification email.                                     |
| `POST /auth/register/verify`               | ○         | consumes email-verification token; activates account.                                                                                                                  |
| `POST /auth/login`                         | ○         | credentials → session cookie. On MFA-enrolled accounts returns `mfa_required` challenge state (short-lived, cookie-scoped) instead of a session. Rate-limited per §17. |
| `POST /auth/login/mfa`                     | ○         | TOTP code or recovery code completes the challenge → session.                                                                                                          |
| `POST /auth/logout`                        | ⚿         | revokes current session; clears cookie.                                                                                                                                |
| `GET /auth/session`                        | ⚿         | current session + user summary (the "who am I" bootstrap call).                                                                                                        |
| `GET /auth/sessions`                       | ⚿         | list caller's active sessions (device, ip, last seen).                                                                                                                 |
| `POST /auth/sessions/{sessionId}/revoke`   | ⚿         | remote sign-out. `…/revoke-all` variant revokes all but current.                                                                                                       |
| `POST /auth/password/forgot`               | ○         | always `202`, neutral body; sends reset token.                                                                                                                         |
| `POST /auth/password/reset`                | ○         | token + new password; revokes all sessions on success.                                                                                                                 |
| `POST /auth/password/change`               | ⚿         | current + new password; requires recent auth (step-up, §3.1).                                                                                                          |
| `GET /auth/oauth/{provider}/start`         | ○         | redirect to provider (PKCE); `state` bound to a pre-auth cookie.                                                                                                       |
| `GET /auth/oauth/{provider}/callback`      | ○         | code exchange → session, or account-linking confirmation flow per Architecture §16.                                                                                    |
| `POST /auth/mfa/totp/enroll`               | ⚿ step-up | returns provisioning URI + secret (one render); unconfirmed enrollments expire.                                                                                        |
| `POST /auth/mfa/totp/confirm`              | ⚿         | first valid code activates; returns recovery codes (one render).                                                                                                       |
| `POST /auth/mfa/totp/disable`              | ⚿ step-up | also revokes recovery codes.                                                                                                                                           |
| `POST /auth/mfa/recovery-codes/regenerate` | ⚿ step-up | invalidates prior set.                                                                                                                                                 |

### 3.1 Step-up ("recent auth")

Sensitive operations (marked _step-up_ above; also used by rbac-gated adopter
endpoints) require `mfa_verified_at`/re-auth within a configurable window
(default 10 min). Failing that, the API returns `403` with code
`auth/step_up_required`; the client re-authenticates via `POST /auth/step-up`
(password or TOTP). _Why a dedicated error code + endpoint:_ step-up must be a
uniform, SDK-automatable dance, not a per-endpoint invention.

### 3.2 API keys (org-scoped, machine access)

| Endpoint                                              | Access                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /organizations/{orgId}/api-keys`                 | ⚿⚿ `auth:api_key.read`                                                                                                                                      |
| `POST /organizations/{orgId}/api-keys`                | ⚿⚿ `auth:api_key.create` — returns full key **once**; thereafter only `keyPrefix`. Scopes ⊆ creator's permissions (no privilege escalation by key minting). |
| `POST /organizations/{orgId}/api-keys/{keyId}/revoke` | ⚿⚿ `auth:api_key.revoke`                                                                                                                                    |

## 4. Users

The authenticated user's own account (`/me` namespace — a user manages
_themselves_; managing _others_ happens through org membership and admin
surfaces, never here):

| Endpoint                | Access    | Notes                                                                                                           |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /me`               | ⚿         | profile + flags (mfa enrolled, verified).                                                                       |
| `PATCH /me`             | ⚿         | displayName; email change runs verify-new-then-switch flow (`POST /me/email/change` + `…/confirm`).             |
| `GET /me/organizations` | ⚿         | memberships with org summaries + baseline role — the org-switcher call.                                         |
| `POST /me/delete`       | ⚿ step-up | two-phase self-deletion (soft → purge, DB §17); blocked while sole owner of any org (`409 tenancy/sole_owner`). |
| `GET /me/export`        | ⚿ step-up | starts a data-export job (GDPR); result delivered via notification with signed URL.                             |

## 5. Organizations (`tenancy` module)

| Endpoint                                              | Access                                     | Notes                                                                      |
| ----------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `POST /organizations`                                 | ⚿                                          | create team org; creator becomes owner.                                    |
| `GET /organizations/{orgId}`                          | ⚿⚿ `tenancy:organization.read`             |                                                                            |
| `PATCH /organizations/{orgId}`                        | ⚿⚿ `tenancy:organization.update`           | name, slug (slug change returns warning header — old links break).         |
| `POST /organizations/{orgId}/delete`                  | ⚿⚿ `tenancy:organization.delete` + step-up | two-phase (DB §5); `POST …/restore` within window.                         |
| `GET /organizations/{orgId}/members`                  | ⚿⚿ `tenancy:member.read`                   | filter: `status`, `role`; sort: `joinedAt`.                                |
| `PATCH /organizations/{orgId}/members/{userId}`       | ⚿⚿ `tenancy:member.update`                 | baseline role changes; last-owner demotion → `409 tenancy/sole_owner`.     |
| `POST /organizations/{orgId}/members/{userId}/remove` | ⚿⚿ `tenancy:member.remove`                 | self-removal allowed sans permission (leaving is a right, not a grant).    |
| `POST /organizations/{orgId}/transfer-ownership`      | owner + step-up                            | explicit, audited command — deliberately not a PATCH on membership.        |
| `GET /organizations/{orgId}/invitations`              | ⚿⚿ `tenancy:invitation.read`               | pending + history.                                                         |
| `POST /organizations/{orgId}/invitations`             | ⚿⚿ `tenancy:invitation.create`             | email + baseline role; idempotent per pending (email) — re-invite resends. |
| `POST /organizations/{orgId}/invitations/{id}/revoke` | ⚿⚿ `tenancy:invitation.revoke`             |                                                                            |
| `GET /invitations/{token}`                            | ○                                          | invitation preview (org name, inviter) — safe subset only.                 |
| `POST /invitations/{token}/accept`                    | ⚿                                          | joins org; registration flow composes with this for new users.             |

## 6. Teams

**Decision: there is no "Team" resource in v1 — and this is a named decision,
not an omission.** The platform's ubiquitous language (Architecture §5) has one
grouping concept: the **organization**. Sub-org teams/groups imply nested
scoping, role inheritance, and billing questions that Architecture §19
explicitly defers (org hierarchies, revisit-by-ADR).

What adopters do today, documented:

- **UI aliasing:** call organizations "teams"/"workspaces" in product copy —
  the API name stays stable.
- **Adopter-domain grouping:** product-level groups (project members, channels)
  are adopter domain, authorized via the rbac decision port with adopter-
  registered permissions.

When sub-org teams arrive (post-1.0 ADR), they will be a tenancy extension
(`/organizations/{orgId}/teams/…`) — the URL space is reserved now so nothing
squats on it.

## 7. Permissions (`rbac` module)

| Endpoint                                             | Access                      | Notes                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /organizations/{orgId}/permissions`             | ⚿⚿ `rbac:role.read`         | the permission catalog (platform + adopter-registered), grouped by module — powers role-editor UIs.                                                                                                                                                                   |
| `GET /organizations/{orgId}/roles`                   | ⚿⚿ `rbac:role.read`         | system + custom roles.                                                                                                                                                                                                                                                |
| `POST /organizations/{orgId}/roles`                  | ⚿⚿ `rbac:role.create`       | entitlement-gated (`custom_roles`); grants ⊆ creator's own permissions.                                                                                                                                                                                               |
| `PATCH /organizations/{orgId}/roles/{roleId}`        | ⚿⚿ `rbac:role.update`       | custom roles only (`403` on system roles, code `rbac/system_role_immutable`).                                                                                                                                                                                         |
| `DELETE /organizations/{orgId}/roles/{roleId}`       | ⚿⚿ `rbac:role.delete`       | `409 rbac/role_in_use` while assigned (RESTRICT, DB §6).                                                                                                                                                                                                              |
| `GET /organizations/{orgId}/members/{userId}/roles`  | ⚿⚿ `rbac:assignment.read`   |                                                                                                                                                                                                                                                                       |
| `POST /organizations/{orgId}/members/{userId}/roles` | ⚿⚿ `rbac:assignment.create` | assign role. `DELETE …/{roleId}` unassigns.                                                                                                                                                                                                                           |
| `GET /organizations/{orgId}/me/permissions`          | ⚿                           | caller's effective permission set + version — the UI-gating bootstrap call, cache-keyed by the authz version (DB §6).                                                                                                                                                 |
| `POST /organizations/{orgId}/permissions/check`      | ⚿                           | `{permission, subjectUserId?}` → decision **with rationale** (matched role/rule). Self-checks free; checking others needs `rbac:assignment.read`. _Why an endpoint:_ "why can('t) X do Y" is the #1 enterprise support question — answerable by API, not archaeology. |

## 8. Billing (`billing` module)

| Endpoint                                                  | Access                                     | Notes                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /plans`                                              | ○                                          | public plan catalog (active plans, entitlement specs, display prices) — pricing pages need no auth.                                                                            |
| `GET /organizations/{orgId}/billing/subscription`         | ⚿⚿ `billing:subscription.read`             | current subscription + status; `404`-free: returns `{status:"none"}` shape for never-subscribed.                                                                               |
| `POST /organizations/{orgId}/billing/checkout`            | ⚿⚿ `billing:subscription.manage`           | plan key → provider checkout session URL. **Idempotency-Key required** (§21).                                                                                                  |
| `POST /organizations/{orgId}/billing/subscription/change` | ⚿⚿ `billing:subscription.manage`           | plan/seat changes; proration preview via `?preview=true` (dry-run — returns amounts, commits nothing).                                                                         |
| `POST /organizations/{orgId}/billing/subscription/cancel` | ⚿⚿ `billing:subscription.manage` + step-up | at period end by default; `immediately:true` explicit.                                                                                                                         |
| `GET /organizations/{orgId}/billing/portal`               | ⚿⚿ `billing:subscription.manage`           | provider-hosted portal session URL (payment methods, invoices live provider-side per Architecture §21 — core does not reimplement card vaults).                                |
| `GET /organizations/{orgId}/entitlements`                 | ⚿                                          | effective entitlements + version — every member may read (UIs everywhere gate on these); mirrors the server-side check exactly.                                                |
| `POST /billing/webhooks/{provider}`                       | ○ (signature-verified)                     | provider webhook ingestion: signature + timestamp window, dedupe by provider event id (DB §7), `2xx` fast, processing async. Not part of the public API contract (`internal`). |

## 9. Notifications (`notifications` module)

| Endpoint                                              | Access                           | Notes                                                                                                                     |
| ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /me/notifications`                               | ⚿                                | in-app inbox; filter `unread`, cursor-paginated; `GET …/unread-count` for badges (cheap, cacheable).                      |
| `POST /me/notifications/{id}/read`                    | ⚿                                | `…/read-all` batch variant.                                                                                               |
| `POST /me/notifications/{id}/archive`                 | ⚿                                |                                                                                                                           |
| `GET /me/notification-preferences`                    | ⚿                                | matrix of category × channel (global + per-org overrides).                                                                |
| `PUT /me/notification-preferences`                    | ⚿                                | full-matrix put (small, finite domain — PUT beats surgical PATCH here); `security` category immutable (`422` on attempt). |
| `GET /organizations/{orgId}/notifications/deliveries` | ⚿⚿ `notifications:delivery.read` | delivery log (masked recipients, status, errors) — the "did the invite email send?" support surface.                      |

Sending is **not** an HTTP concern: modules and adopter code send through the
application-layer API. A raw `POST /send` endpoint would bypass templates,
preferences, and rate discipline — exactly the failure the module exists to
prevent.

## 10. Storage (`storage` port surface)

Uploads use the **signed-URL handshake** — bytes never transit the application
(Architecture §22):

| Endpoint                                              | Access                   | Notes                                                                                                                                                    |
| ----------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /organizations/{orgId}/files`                   | ⚿⚿ `storage:file.create` | `{filename, contentType, sizeBytes}` → `{fileId, uploadUrl, headers, expiresAt}`; content-type/size validated against policy _before_ any URL is signed. |
| `POST /organizations/{orgId}/files/{fileId}/complete` | ⚿⚿ `storage:file.create` | confirms upload; server verifies checksum/size with provider; `pending → available` (DB §12).                                                            |
| `GET /organizations/{orgId}/files/{fileId}`           | ⚿⚿ `storage:file.read`   | metadata.                                                                                                                                                |
| `GET /organizations/{orgId}/files/{fileId}/download`  | ⚿⚿ `storage:file.read`   | short-TTL signed GET URL (`302` or JSON per `Accept`).                                                                                                   |
| `DELETE /organizations/{orgId}/files/{fileId}`        | ⚿⚿ `storage:file.delete` | soft → purge (DB §12).                                                                                                                                   |
| `GET /organizations/{orgId}/files`                    | ⚿⚿ `storage:file.read`   | list; filter `contentType`, `uploadedBy`; sort `createdAt`, `sizeBytes`.                                                                                 |

## 11. Plugins

**Decision: no plugin management API — consistent with Architecture §24 and
DB §13.** Plugins are npm modules wired at composition time; there is nothing
to install, enable, or configure over HTTP, and an endpoint that could would be
remote-code-execution-as-a-feature.

What third-party modules _do_ get, as first-class API citizens:

- **Route contribution:** a module's interface bindings mount under a reserved
  namespace `/x/{moduleKey}/…` (e.g. `/x/acme-crm/contacts`). _Why a prefix:_
  core's URL space stays collision-free and forward-compatible; adopters see at
  a glance which routes are third-party.
- Full access to the same machinery: `Context`, permission registration (their
  permissions appear in §7's catalog), error taxonomy, pagination helpers, and
  OpenAPI merge (§24) — a well-built third-party module is indistinguishable
  from core in tooling and docs.

## 12. AI

**Consistent with DB §14: reserved, deferred, honest.** No AI endpoints ship in
v1; the namespace `/organizations/{orgId}/ai/…` is reserved for the future
`@corestack/ai` module (post-1.0, vision-amendment ADR required).

Reserved surface sketch (recorded so the eventual design composes with today's
standards): `POST …/ai/conversations` / `GET …/ai/conversations` (CRUD per DB
§14), `POST …/ai/conversations/{id}/messages` with **SSE streaming responses**
(the one place the JSON-only rule will need a documented exception — flagged
now so §18's versioning strategy anticipates a media-type addition, not a
breaking change), and usage rollups under `…/ai/usage` feeding entitlement
quotas. All of it org-scoped, entitlement-gated, metered per DB §14.

## 13. Search

**Decision: no global search endpoint in v1** (Architecture §23 — no search
module until two modules need one). Restated at the API layer:

- **Per-resource filtering** (§22) covers the actual v1 needs: member lookup by
  email prefix, audit filtering, file listing.
- **Audit is the one full-text surface:** `GET …/audit/events?q=…` (§14's audit
  listing) maps `q` to the Postgres FTS column (DB §8).
- A future federated `GET /organizations/{orgId}/search` would demand
  cross-module result ranking and per-module permission filtering — real
  design work that must not be improvised as query-param creep. If demand
  materializes, it arrives as its own design doc.

## 14. Admin

Two distinct things called "admin," kept strictly apart:

1. **Org admin** — everything permission-gated above (§5–§10). No separate
   namespace: org administration _is_ the API + rbac. Building a parallel
   "admin API" would fork every permission check into two places.
2. **Platform operator surface** (`/admin/…`, stability `internal`) — for the
   _adopter's own operators/support staff_, guarded by platform-level
   permissions (`admin:*` family) that no org role can ever grant, plus
   step-up. v1 set, deliberately minimal:

| Endpoint                                            | Permission                   | Notes                                                                                                     |
| --------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /admin/users` / `GET /admin/users/{id}`        | `admin:user.read`            | lookup across orgs (support: "user can't log in").                                                        |
| `POST /admin/users/{id}/suspend` / `…/unsuspend`    | `admin:user.suspend`         | suspends account + revokes sessions (immediate, per Architecture §16).                                    |
| `GET /admin/organizations` / `…/{id}`               | `admin:organization.read`    |                                                                                                           |
| `POST /admin/organizations/{id}/suspend`            | `admin:organization.suspend` | abuse response.                                                                                           |
| `GET /admin/audit/events`                           | `admin:audit.read`           | cross-org audit query (same shape as org audit, unscoped).                                                |
| `POST /admin/billing/entitlements/{orgId}/override` | `admin:billing.override`     | the support-gesture path (DB §7 `source='override'`) — exists as API so overrides are audited, not SQL'd. |

Every `/admin` call is itself audit-logged with the operator as actor —
the support team is inside the compliance perimeter, not above it.

## 15. Public APIs

Classification of the whole surface by intended consumer:

| Tier                 | Consumers                      | Auth                                   | Examples                                                          |
| -------------------- | ------------------------------ | -------------------------------------- | ----------------------------------------------------------------- |
| **Browser API**      | the adopter's own frontend     | session cookie (+CSRF, §19)            | §3–§10 via cookies                                                |
| **Programmatic API** | scripts, integrations, servers | `Authorization: Bearer csk_…` API keys | same endpoints, key-scoped                                        |
| **Unauthenticated**  | anyone                         | none (rate-limited hard)               | `GET /plans`, invitation preview, register/login, OAuth callbacks |
| **Ingestion**        | providers                      | signatures                             | billing webhooks                                                  |
| **Internal**         | adopter's operators            | session + `admin:*`                    | §14                                                               |

**Decision: one API, two credentials — not two APIs.** The same endpoints
serve browsers (cookies) and machines (API keys); the security layer differs
(§19), the resource model does not. _Why:_ dual surfaces drift; drift breeds
undocumented behavior; undocumented behavior breeds security holes. API keys
simply cannot reach session-bound endpoints (`/auth/*` session flows, `/me`
step-up operations return `403 auth/api_key_not_allowed`).

## 16. Webhooks (outbound platform events)

Management API (org-scoped):

| Endpoint                                                                      | Access                                                                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /organizations/{orgId}/webhooks`                                         | ⚿⚿ `webhooks:endpoint.read`                                                                                 |
| `POST /organizations/{orgId}/webhooks`                                        | ⚿⚿ `webhooks:endpoint.create` — url (https-only, SSRF-filtered), event allowlist; secret returned **once**. |
| `PATCH /organizations/{orgId}/webhooks/{id}`                                  | ⚿⚿ `webhooks:endpoint.update` — pause/resume, event list.                                                   |
| `DELETE /organizations/{orgId}/webhooks/{id}`                                 | ⚿⚿ `webhooks:endpoint.delete`                                                                               |
| `POST /organizations/{orgId}/webhooks/{id}/rotate-secret`                     | ⚿⚿ `webhooks:endpoint.update` + step-up — dual-signing window per DB §11.                                   |
| `GET /organizations/{orgId}/webhooks/{id}/deliveries`                         | ⚿⚿ `webhooks:endpoint.read` — attempt log (DB §11).                                                         |
| `POST /organizations/{orgId}/webhooks/{id}/deliveries/{deliveryId}/redeliver` | ⚿⚿ `webhooks:endpoint.update`                                                                               |
| `POST /organizations/{orgId}/webhooks/{id}/test`                              | ⚿⚿ `webhooks:endpoint.update` — sends a signed `ping` event.                                                |

Delivery contract (what adopters' endpoints receive):

- `POST` with JSON body `{id, name, version, occurredAt, organizationId, data}`
  — the versioned event envelope (Architecture §13).
- Headers: `CoreStack-Event` (name), `CoreStack-Delivery` (delivery id),
  `CoreStack-Signature: t=<unix>,v1=<hmac-sha256(t + "." + body)>`; receivers
  must verify signature and reject `|now - t| > 5 min` (replay window).
  Dual secrets during rotation ⇒ multiple `v1=` values.
- Retries: exponential backoff with jitter over ≤ 24 h on non-`2xx`;
  auto-disable after sustained failure (DB §11) with a notification.
  **At-least-once ⇒ receivers must dedupe on delivery/event id** — stated in
  docs, headers, and the test event's payload, because every consumer learns
  this the hard way exactly once.

## 17. Rate Limiting

- **Enforced at the use-case layer via the `RateLimiter` port** (Architecture
  §25) — so limits hold across every transport, not just HTTP.
- **Buckets, tightening in order of abuse surface:** per-IP (unauthenticated
  endpoints), per-user (session), per-API-key, per-org (aggregate); auth
  endpoints additionally per-target (per-email login/reset throttles — the
  credential-stuffing brake).
- **Reference defaults** (adopter-tunable, published in docs): login 10/min/IP +
  5/min/email; reset 3/hr/email; general authenticated 600/min/org; key-based
  600/min/key; unauthenticated 60/min/IP. Defaults exist because "configure it
  yourself" is how nobody configures it.
- **Response contract:** `429` + problem body (code `core/rate_limited`) +
  `Retry-After`; every response carries IETF `RateLimit-Limit`,
  `RateLimit-Remaining`, `RateLimit-Reset` headers so clients can self-pace
  _before_ hitting 429s. SDKs honor these automatically (§25).

## 18. Versioning Strategy

- **URL major version (`/v1`)**, per Architecture §26. Within `/v1`:
  - **Additive changes are non-breaking by contract:** new endpoints, new
    _optional_ request fields, new response fields, new enum values _where the
    field is documented open-ended_ (event names, permission keys). Clients
    must ignore unknown response fields — stated in the spec, enforced in SDKs.
  - **Never within a major:** removing/renaming fields or endpoints, changing
    types/semantics, tightening validation on existing fields, closing an open
    enum.
- **Deprecation protocol:** `Deprecation` + `Sunset` headers on affected
  endpoints, changelog entry, ≥ 2 minor releases' notice (pre-1.0: best-effort
  with loud 0.x labeling per vision).
- **`/v2` is a last resort** — a parallel surface maintained alongside `/v1`
  for a published overlap window, driven by the same use cases (versions differ
  at the binding/DTO layer only, which is what makes dual-running affordable).
- Event envelope versions (§16) and API versions are independent tracks —
  webhook consumers pin event versions per Architecture §13.

## 19. Request Standards

- **JSON bodies (`application/json`, UTF-8) exclusively**; multipart exists
  nowhere (uploads use signed URLs, §10). Unknown _request_ fields are
  **rejected** (`422`) — silently ignoring caller typos (`emial`) is a bug
  factory; strict-in is Postel's law's fine print. (Responses are the opposite:
  clients must tolerate unknown fields, §18.)
- **Field naming: camelCase**; ids are UUID strings; timestamps ISO 8601 UTC
  (`2026-07-28T12:00:00Z`); money as `{amount: minorUnits, currency}` objects
  mirroring DB rule 8; durations in explicit-unit fields (`expiresInSeconds`).
- **Authentication:** session cookie (HttpOnly, Secure, SameSite=Lax) _or_
  `Authorization: Bearer csk_…`. **CSRF defense for cookie calls:** all unsafe
  methods require the custom header `X-CoreStack-Request: 1` + Origin/Referer
  allowlist check — the custom-header pattern because it's the simplest defense
  that composes with SameSite (tokens-in-forms are stateful complexity the
  SPA-era doesn't need).
- **Context headers:** `X-Request-Id` accepted (else generated) and echoed —
  joins the correlation model (Architecture §32); `Idempotency-Key` per §21.
- **Size limits:** 1 MiB default JSON body cap (per-endpoint overrides
  documented); depth/array caps enforced by the Zod boundary — resource
  exhaustion is a parsing-layer concern, handled once.

## 20. Response Standards

- **Single resource → the object itself** (no envelope): `GET …/{id}` returns
  the resource. **Lists → `{data: […], pagination: {…}}`** (§21). _Why
  envelope-for-lists-only:_ single objects gain nothing from wrapping, lists
  need a home for cursors; mixing conventions per-endpoint would be worse than
  either convention alone.
- **Status usage:** `200` reads/commands with results; `201` + `Location` on
  creation; `202` for accepted-async (register, export jobs); `204` for
  void commands; `304` supported on hot cacheable reads (`ETag` on
  `/me/permissions`, entitlements — version-stamped per DB §6/§7, so ETags are
  free and _correct_).
- **Every response carries:** `X-Request-Id`; rate-limit headers (§17);
  `Cache-Control: no-store` by default (opt-in caching only on the
  version-stamped reads above — an authenticated SaaS API that default-caches
  is a data-leak lottery).
- Response DTOs are projections shaped for consumers — never raw rows; fields
  the caller lacks permission to see are _absent_, not nulled (absence is
  unambiguous; null means "known and empty").

## 21. Error Responses (+ Idempotency)

RFC 9457 `application/problem+json`, one shape everywhere:

- Fields: `type` (docs URL per code), `title`, `status`, `detail` (safe,
  human), `code` (the stable machine key, e.g. `core/forbidden`,
  `tenancy/sole_owner`, `auth/step_up_required`), `requestId`, and for
  validation failures `errors: [{path, code, message}]` (Zod issues, mapped —
  never raw Zod output, which is an implementation detail).
- **Code registry is part of the public API** (semver-governed, §18): kernel
  codes (`core/*`) map from the error taxonomy; modules own their namespaces.
  HTTP status is _derived from_ the code by one table (Architecture §26):
  validation→422, unauthorized→401, forbidden/step-up→403, not-found→404
  (including _exists-but-other-tenant_ — indistinguishable by design, DB §15),
  conflict→409, rate→429, unexpected→500 (generic body, full detail only in
  logs — internals never leak).
- **Idempotency-Key** (required on §8 money mutations, accepted on all
  `POST`s): first request stores result under `(scope, key)` (DB §3); replays
  return the stored response + `Idempotency-Replayed: true`; same key +
  _different_ body → `409 core/idempotency_key_reuse`. 24 h retention.

## 22. Pagination, Filtering, Sorting

- **Pagination: opaque cursors only** (`?cursor=…&limit=…`, limit default 20,
  max 100): `pagination: {nextCursor: string|null, hasMore: boolean}`. No
  `totalCount` by default — counting kills large tables; where product UX truly
  needs counts, an explicit `?includeTotal=true` exists on designated endpoints
  with a documented cost note. Cursors encode `(sortKey, id)` server-side,
  signed — clients never parse them (opacity _is_ the compatibility contract).
- **Filtering: explicit, allowlisted query params per endpoint**
  (`?status=active&role=admin`), typed in OpenAPI. Repeat params for OR-sets
  (`?status=active&status=invited`). **No generic filter language** (rejected:
  RSQL/OData/JSON-filters) — a query DSL is an injection surface, an index
  wildcard, and an un-versionable API all at once; every filter we ship maps to
  an index that exists (DB per-table listings).
- **Sorting: `?sort=-createdAt`** (leading `-` = desc), allowlisted fields per
  endpoint, single-key in v1 (multi-key adds cursor complexity nothing yet
  needs); every sortable field is index-backed, and the sort key is folded into
  the pagination cursor — sorting and cursoring are one mechanism, not two.

## 23. OpenAPI Specification Structure

- **Generated, never hand-written** (Architecture §26): the same Zod schemas
  that validate at runtime emit OpenAPI 3.1 — the spec _cannot_ drift from
  behavior, which is the entire strategy.
- **Structure:** one spec per module (`auth.openapi.json`, …) merged by the CLI
  (`corestack generate openapi`) into the adopter's composed spec — the spec
  mirrors composition: only installed modules' endpoints appear, third-party
  modules (§11) merge under their `/x/` namespace identically.
- **Conventions inside the spec:** `tags` = module names; `operationId` =
  `module.useCase` (`tenancy.inviteMember`) — the stable key SDK generation
  keys on; security schemes `sessionCookie` + `apiKey`; shared components for
  problem shape, pagination, money, ids; every operation documents its error
  codes (`x-error-codes`), permission (`x-permission`), stability
  (`x-stability`), and at least one request/response example (examples are
  load-bearing: they feed docs _and_ contract tests).
- The published spec is itself semver'd and shipped as an artifact of every
  release — diffs of the spec are the API changelog's source of truth.

## 24. SDK Generation Strategy

Per Architecture §28, made concrete:

- **`@corestack/client` is generated from the merged OpenAPI spec** at the
  adopter's build (or consumed pre-generated for core-only installs). Surface
  mirrors `operationId`: `client.tenancy.inviteMember({orgId, email, role})` —
  one mental model from docs → API → SDK.
- **The SDK encodes this document's contracts so humans don't have to:** typed
  errors (code registry → discriminated union — `catch (e) { if
(e.code === "tenancy/sole_owner") … }`), automatic rate-limit pacing +
  `Retry-After` honoring with jittered retries on idempotent calls only,
  automatic `Idempotency-Key` minting on §8 mutations, cursor iteration
  helpers (`for await (const m of client.tenancy.members.iterate(…))`),
  step-up interception hook (§3.1: `auth/step_up_required` → adopter-provided
  re-auth callback → transparent replay), CSRF header injection, unknown-field
  tolerance (§18).
- **Environments:** browser + Node from one package (fetch-based, zero deps);
  framework sugar (React hooks) is a separate thin package, later — the core
  client stays framework-free.
- **Other languages** (post-1.0, per vision §15): same pipeline, same
  `operationId` naming, Python then Go; generated clients only — hand-written
  SDKs are how multi-language support dies of drift.
- **Server-side TypeScript adopters skip HTTP entirely** (use cases in-process,
  Architecture §28); the SDK is for browsers and external consumers — the docs
  route each audience to the right door.

---

**Stopping here, per instruction.** Upon approval, this document joins the
ADR-0007+ codification batch (Architecture §48), and the identity-core
requirements phase proceeds with §3–§5's endpoint sets as the API contract for
`auth` and `tenancy`.
