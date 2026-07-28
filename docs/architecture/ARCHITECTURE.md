# CoreStack — Software Architecture Document

- **Status:** Draft, awaiting founder approval
- **Version:** 0.1
- **Date:** 2026-07-28
- **Precedes:** all module implementation beyond `@corestack/kernel`
- **Depends on:** [Product Vision](../product/VISION.md), [ADRs 0001–0006](../adr/README.md)

Decisions introduced here that are hard to reverse will be codified as ADRs 0007+
upon approval of this document. Where this document says **Decision**, it is
normative; where it says **Guidance**, adopters may deviate.

---

## 1. Executive Architecture

**CoreStack is a modular monolith delivered as a family of versioned TypeScript
packages, composed inside the adopter's own application process, over the adopter's
own PostgreSQL database.**

The five load-bearing choices, and why:

1. **Library platform, not a service.** CoreStack runs _inside_ the adopter's
   process. There is no CoreStack server, gateway, or control plane to operate.
   This is the structural guarantee behind the vision's ownership promise — you
   cannot be locked into something that doesn't exist.
2. **Modular monolith.** One deployable by default, with module boundaries strict
   enough that extracting a module into a service later is mechanical. Adopters get
   monolith operational simplicity with microservice-grade boundaries.
3. **Clean Architecture per module.** Four layers, dependencies point inward,
   infrastructure behind ports. This is what makes "swap anything" true rather
   than aspirational.
4. **Events over imports.** Modules never reach into each other; they consume each
   other's public APIs and domain events. Cross-cutting features (audit, webhooks,
   notifications) are event consumers, which is why any subset of modules works.
5. **Boring, ubiquitous infrastructure.** PostgreSQL for state, the process itself
   for eventing (with a transactional outbox for reliability), Postgres again for
   queues by default. A new SaaS should need exactly two things: Node and Postgres.

```
┌─────────────────────────── Adopter's application ───────────────────────────┐
│                                                                             │
│  Adopter's domain code          Interface bindings (HTTP/CLI/jobs)          │
│         │                              │                                    │
│         ▼                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  CoreStack modules:  auth │ tenancy │ rbac │ billing │ audit │ ...   │   │
│  │  each = domain + application + ports          (kernel underneath)    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│         │ ports                        │ events (in-proc bus + outbox)      │
│         ▼                              ▼                                    │
│  Adapters: Postgres, mail, Stripe, queues, storage, telemetry               │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               ▼
                    Adopter's PostgreSQL (+ optional Redis, S3, …)
```

## 2. High-Level Architecture

**Components:**

- **Kernel** (`@corestack/kernel`) — shared contracts only: `Result`, error
  taxonomy, `Clock`, `IdGenerator`, `EventBus`, `Logger` ports. No business meaning.
- **Modules** — one package per bounded context (§6). Each exposes: use cases
  (its public API), domain events (its published contracts), ports (what it needs
  from the world), and reference adapters (subpath exports, §7).
- **Composition root** — the adopter's startup code wires modules to adapters and
  configuration. CoreStack ships a lightweight `createCoreStack()` composition
  helper so wiring is declarative; it is convenience, not magic — adopters can wire
  by hand.
- **Interface bindings** — thin translators from a transport (HTTP framework,
  CLI, queue consumer) to use case invocations. Bindings are adapters too.
- **Reference application** (`apps/reference-nextjs`) — proves the composition
  end-to-end and serves as living documentation.

**Why a composition root instead of a DI framework:** decorator-based DI containers
(Nest-style) couple adopters to a framework and to `experimentalDecorators`.
Explicit constructor injection wired at one composition point is plain TypeScript,
fully typed, and trivially testable. The cost — some wiring verbosity — is paid
once per application, and `createCoreStack()` amortizes it.

**Runtime topology (default):** one process serving HTTP and running in-process
event consumers; a second process role (same image, different entrypoint flag) for
queue workers when throughput demands it. Both roles are horizontally scalable
because all state lives in Postgres (§21, §41).

## 3. Low-Level Architecture

The anatomy of every module, normative:

- **Use case** — one class/function per business operation
  (`InviteMember`, `RevokeSession`). Accepts a validated input DTO plus an
  ambient `Context` (actor, organization, correlation id); returns
  `Result<OutputDTO, CoreError>`. One transaction per use case (§11). Emits domain
  events on success. This is the _only_ entry point to a module — interface
  bindings, other modules, and the adopter all call use cases.
- **Ports** — interfaces owned by the application layer: repositories
  (`SessionRepository`), gateways (`MailSender`, `PaymentGateway`), and the kernel
  ambient ports. Ports are expressed in domain terms, never in vendor terms
  (`chargeSubscription`, not `createStripeInvoice`).
- **Entities & value objects** — domain layer; enforce invariants in constructors/
  factories; no framework, ORM, or Node types. Identity via ids from `IdGenerator`.
- **Domain events** — immutable facts, named in past tense
  (`member.invited`, `subscription.canceled`), versioned (§13).
- **DTO mapping** — repositories map persistence rows ↔ domain objects at the
  adapter boundary; domain objects never leak ORM shapes, use cases never return
  entities (they return DTOs). Duplication of shape here is deliberate: it is the
  firewall that lets each side evolve independently.
- **Transactions** — a `UnitOfWork` port scopes a use case's writes and its outbox
  event insert into one atomic commit (§13). Adapters own how; use cases own when.
- **Concurrency** — aggregates carry a version column; conflicting writes surface
  as `ConflictError` (optimistic concurrency). Chosen over pessimistic locks
  because SaaS control-plane contention is rare and retries are cheap.

## 4. Clean Architecture

The four layers and the dependency rule (dependencies point inward only):

| Layer            | Contains                                                | May import                               |
| ---------------- | ------------------------------------------------------- | ---------------------------------------- |
| `domain`         | entities, value objects, domain events, domain services | kernel types only                        |
| `application`    | use cases, ports, DTOs, policies                        | `domain`, kernel                         |
| `infrastructure` | adapters implementing ports                             | `application`, `domain`, vendor SDKs     |
| `interface`      | HTTP/CLI/queue bindings, Zod schemas                    | `application` (use cases + DTOs), kernel |

**Why this rigor in a "boring" platform:** the vision's two hardest promises —
_swap anything_ and _upgrade forever_ — are both properties of this structure.
Swapping is possible because vendors only appear in `infrastructure`; upgrading is
safe because the public surface (use cases, DTOs, events, ports) is small and
explicit, so semver commitments cover a defined perimeter.

**Enforcement, not vigilance (Decision):** layer boundaries are enforced by lint
rules (import-boundary checking per directory) and by package `exports` maps that
simply do not expose internals. A rule that isn't machine-enforced will erode.

## 5. Domain Driven Design

- **Ubiquitous language per context.** Each module's docs open with a glossary;
  code identifiers must use glossary terms. Example: tenancy says _organization_,
  _membership_, _invitation_ — never "team," "workspace," or "account" (adopters
  may alias in their own UI; the platform stays consistent).
- **Aggregates** define consistency boundaries: e.g. `Organization` (with
  memberships) in tenancy; `UserAccount` (with credentials, MFA enrollments) and
  `Session` in auth; `Subscription` in billing. A transaction touches one aggregate
  instance per module; cross-aggregate consistency is eventual, via events.
- **Strategic over tactical.** We apply DDD's strategic patterns (contexts, maps,
  language) everywhere, and its tactical patterns (aggregates, VOs) where invariants
  justify them. We do not cargo-cult repositories-for-everything or event-source
  for fashion (§13).
- **The adopter's domain is the real core domain.** CoreStack's contexts are,
  from the adopter's perspective, _generic subdomains_ — exactly the kind of thing
  DDD says you should buy, not build. CoreStack exists to be the best possible
  "buy" that you still fully own.

## 6. Bounded Contexts

| Context           | Owns (core concepts)                                                  | Publishes (events)                                                              | Key consumed contracts                         |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Identity/Auth** | user accounts, credentials, sessions, MFA, OAuth identities, API keys | `user.registered`, `session.created`, `session.revoked`, `user.suspended`       | tenancy: membership checks for org-scoped keys |
| **Tenancy**       | organizations, memberships, invitations                               | `organization.created`, `member.invited/joined/removed`, `organization.deleted` | auth: user existence (by id only)              |
| **RBAC**          | roles, permissions, assignments, policy decisions                     | `role.assigned`, `role.revoked`                                                 | tenancy: membership as the assignment scope    |
| **Billing**       | plans, subscriptions, entitlements                                    | `subscription.created/updated/canceled`, `entitlement.changed`                  | tenancy: organization as the billable unit     |
| **Audit**         | append-only audit trail                                               | — (terminal consumer)                                                           | consumes _all_ contexts' events                |
| **Notifications** | templates, deliveries, preferences                                    | `notification.sent/failed`                                                      | consumes events; called by use cases           |
| **Jobs**          | job definitions, schedules, executions                                | `job.failed` (dead-letter)                                                      | infrastructure-ish context behind a port       |
| **Webhooks**      | endpoints, deliveries, signatures                                     | `webhookdelivery.failed`                                                        | consumes all published events                  |

**Context map rules (Decision):** relationships are _customer–supplier via
published language_ — the published language being versioned domain events and
public use-case DTOs. No shared kernel between modules beyond `@corestack/kernel`
(which is deliberately business-free, so it doesn't count as a DDD shared kernel).
References across contexts are **by id only**; no context embeds another's data
shape beyond ids and denormalized read copies it maintains from events.

**Why auth and tenancy are separate contexts:** they change for different reasons
(credential mechanics vs. organizational structure), and enterprise adopters must
be able to replace auth entirely (their IdP) while keeping tenancy. Fusing them is
the single most common irreversible mistake in SaaS starters.

## 7. Package Strategy

- **One npm package per bounded context**, plus the kernel:
  `@corestack/kernel`, `@corestack/auth`, `@corestack/tenancy`, `@corestack/rbac`,
  `@corestack/billing`, `@corestack/audit`, `@corestack/notifications`,
  `@corestack/jobs`, `@corestack/webhooks`, and `@corestack/cli`.
- **Reference adapters ship inside the module package via subpath exports**
  (Decision): `@corestack/auth` (pure core), `@corestack/auth/postgres`,
  `@corestack/auth/hono`. Vendor SDKs (drizzle, stripe) are **optional peer
  dependencies** — installed only by adopters using that subpath.
  - _Why not separate adapter packages:_ a per-adapter package matrix
    (`auth@1.2` × `auth-postgres@?`) creates version-compatibility hell for
    adopters and triples release overhead. Subpaths keep core and adapter in
    lockstep by construction. The `exports` map keeps the pure core importable
    with zero infrastructure dependencies.
  - _Escape hatch:_ community adapters live in their own packages against the
    documented port contracts and the published contract-test suites (§45).
- **Versioning:** independent semver per package, orchestrated with Changesets;
  a documented compatibility table per release train. Pre-1.0, minor = breaking,
  patch = safe, stated loudly.
- **Public surface discipline:** each package's `exports` map exposes only
  `application` (use cases, DTOs, ports, events) and adapter subpaths. `domain`
  internals are not importable. What isn't exported doesn't exist, semver-wise.

## 8. Module Strategy

- **Lifecycle contract (Decision):** every module exports a factory
  (`createAuthModule(deps, config)`) returning `{ useCases, eventHandlers,
migrations, health }`. The composition root passes adapters in; the module never
  constructs its own infrastructure. This uniformity is what makes
  `createCoreStack()`, the CLI, and documentation consistent across modules.
- **Any subset works.** A module's hard dependencies are: kernel + its own ports.
  Cross-module features degrade gracefully: if audit isn't installed, events simply
  have no audit consumer; if rbac isn't installed, tenancy exposes its built-in
  owner/admin/member baseline roles (§18).
- **Configuration:** each module declares a Zod config schema (secrets referenced,
  never embedded); the composition root validates all config at boot and fails
  fast with precise errors. Runtime reconfiguration is out of scope (restart-based
  config keeps modules stateless and predictable).
- **Module quality gate:** a module ships only with — glossary, threat model,
  reference adapters, contract-test suite for its ports, migration path, and docs.
  This is the definition-of-done from the vision made structural.

## 9. Monorepo Strategy

Per ADR-0002: pnpm workspaces + Turborepo. Refinements now normative:

- **Layout:** `packages/*` (publishable), `apps/*` (reference apps, never
  published), `docs/*` (site source, later), `tooling/*` (shared configs: tsconfig,
  eslint presets, contract-test kit).
- **Task graph:** `build`, `test`, `test:integration`, `typecheck`, `lint` run
  through turbo with remote caching in CI. Integration tests are a separate task
  because they need service containers (§45) and must be skippable locally.
- **Single version policy for tooling** (one TypeScript, one Vitest version across
  the repo) to prevent drift; runtime dependencies remain per-package.
- **Why not split repos per module:** atomic cross-module refactors and one CI are
  worth more than repo purism while APIs are settling; post-1.0 the question can be
  revisited per module via ADR (unlikely — GitLab-style monorepo has aged well).

## 10. Technology Decisions

| Concern                | Decision                                    | Why (and rejected alternatives)                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language               | TypeScript, max-strict                      | ADR-0001; largest SaaS-builder ecosystem                                                                                                                                                                         |
| Runtime floor          | Node.js LTS (≥20); core is runtime-agnostic | ADR-0001; edge/Bun stay possible because domain/application use no Node builtins                                                                                                                                 |
| Modules                | ESM-only                                    | ADR-0001; dual-build complexity rejected                                                                                                                                                                         |
| Persistence            | PostgreSQL + Drizzle (reference)            | ADR-0004; SQL-transparent, thin, auditable (Prisma too heavy, raw SQL too error-prone)                                                                                                                           |
| Validation             | Zod at boundaries                           | ADR-0005                                                                                                                                                                                                         |
| HTTP reference binding | **Hono** first, Next.js binding second      | Hono is runtime-agnostic, tiny, standards-based (Fetch API), and bindable to Node/Bun/edge; Express is legacy-CJS-centric; the binding layer is thin enough that community bindings (Fastify, Express) are cheap |
| Password hashing       | argon2id (OWASP parameters)                 | current best practice; bcrypt fallback documented for constrained hosts                                                                                                                                          |
| Testing                | Vitest + Testcontainers                     | §45                                                                                                                                                                                                              |
| Release                | Changesets                                  | §7                                                                                                                                                                                                               |
| Telemetry API          | OpenTelemetry                               | §31–33; the only vendor-neutral standard                                                                                                                                                                         |
| Docs site              | Starlight/Astro (later phase)               | docs-as-product; static, fast, MD-native                                                                                                                                                                         |

**Meta-decision:** every vendor named above is behind a port except TypeScript,
Node, and Postgres-as-reference. Those three are the platform's honest bets.

## 11. Database Strategy

- **One logical database, one PostgreSQL schema per module** (`auth.*`,
  `tenancy.*`, `billing.*`…). Namespacing gives per-module ownership, obvious
  blast radius, and clean permission boundaries, while keeping single-database
  operational simplicity and cross-module transactional outbox writes possible.
- **No cross-module foreign keys** (Decision, per §6): referential integrity
  across contexts is maintained by events + reconciliation, not constraints.
  _Why:_ cross-schema FKs would fuse deployment and migration order across
  modules — exactly the coupling module boundaries exist to prevent. Within a
  module, FKs are used liberally.
- **Migrations:** each module owns an ordered migration set (plain SQL, shipped in
  the package); the CLI (`corestack migrate`) composes and applies them with a
  per-module version table. Migrations are forward-only in production; down
  migrations exist for development. Expand-and-contract pattern is mandatory for
  zero-downtime upgrades (documented per release).
- **Access pattern:** repositories only; every tenant-scoped port method takes the
  organization id (§20). No ORM lazy loading (Drizzle has none — a feature);
  every query is explicit, reviewed for N+1 at design time (vision NFR-3).
- **Data classes:** each table documents its data classification (PII, secret,
  operational) — this drives encryption, redaction, and retention (§42).

## 12. Caching Strategy

- **Default: no cache.** Correctness first; Postgres is fast and most CoreStack
  data (orgs, roles, plans) is small and hot in Postgres's own buffers. Premature
  caching is the leading source of stale-permission security bugs.
- **`CachePort` in the kernel** with reference adapters: in-memory LRU
  (single-node) and Redis (multi-node). Cache use is opt-in per module feature.
- **Sanctioned uses (Guidance):** session lookup (with revocation kept safe: the
  cache TTL bounds revocation lag ≤ 30s, and _security-critical revocations bypass
  cache_ via a version-stamped key); policy/entitlement snapshots keyed by
  (org, subject, version) where the version bumps on any role/entitlement change —
  invalidation by key-versioning, never by enumeration.
- **Forbidden uses (Decision):** caching authorization _decisions_ across version
  bumps; caching anything unhashed-secret-adjacent; caches as source of truth.

## 13. Event Bus

The spine of the platform. Three-part design:

1. **Contracts:** domain events are versioned, additive-evolving JSON-serializable
   facts (`tenancy.member.removed.v1`). Renames/removals require a new version;
   consumers declare the versions they accept. Events carry: id, occurred-at,
   organization id (if tenant-scoped), actor, correlation/causation ids, payload.
2. **In-process delivery (default):** synchronous, after-commit dispatch to
   registered consumers in the same process. Simple, ordered, zero infrastructure.
3. **Reliable delivery (transactional outbox, Decision):** every use case writes
   its events to an `outbox` table _in the same transaction_ as its state change;
   a relay (in-process poller by default) dispatches after commit, with
   at-least-once semantics and per-consumer checkpoints. Consumers must be
   idempotent (event id dedupe helper provided).
   - _Why outbox over "just publish":_ publish-after-commit without an outbox
     silently drops events on crash — fatal for audit/billing/webhooks integrity.
   - _Why not a broker (Kafka/NATS) in core:_ infrastructure tax on every adopter
     for throughput they don't have. The relay is behind a port; a broker-backed
     relay is a clean adapter for adopters who outgrow polling (§14, §41).
4. **Not event sourcing (Decision):** state is stored as current state; events are
   _published facts_, not the persistence model. Event sourcing's costs (rebuild
   complexity, versioning burden on every read) aren't justified for SaaS
   control-plane data. The audit module gives the append-only history where it's
   actually needed.

## 14. Queues

- **`JobQueue` port** (enqueue, schedule with cron/interval, retry policy,
  dead-letter). Owned by the jobs context; usable by all modules and the adopter.
- **Reference adapter: Postgres-backed** (`FOR UPDATE SKIP LOCKED` worker polling,
  the pg-boss pattern). _Why:_ zero extra infrastructure — the "Node + Postgres is
  enough" promise — and transactionally consistent enqueue (a job enqueued in a use
  case commits or rolls back with it).
- **Second adapter: BullMQ/Redis** for adopters needing >~1k jobs/sec or
  sub-second latency. The port is the contract; the contract-test suite (§45)
  guarantees behavioral equivalence (visibility timeout, at-least-once, retries).
- Workers run in the same image under a worker entrypoint (§2), scaled
  independently. Job handlers receive the same `Context` shape as use cases —
  jobs are just deferred use-case invocations.

## 15. Notifications

- Channel ports: `MailSender` (first), `InAppInbox` (second); SMS/push are
  community-adapter territory.
- **Templates are code-adjacent, not DB-stored** (Decision): versioned template
  registry in the adopter's repo (typed variables via Zod), because templates
  change with code and must be reviewable/diffable. A DB-backed template editor is
  a possible enterprise module later — not core.
- Deliveries are jobs (via §14) with per-delivery status records; failures emit
  events. End-user notification preferences (per category opt-outs) live in this
  context and are enforced at dispatch, giving adopters compliance (e.g.
  transactional-vs-marketing separation) for free.
- Reference mail adapters: SMTP and one API provider (Resend), proving the port
  from both ends of the market.

## 16. Authentication

- **Session model (Decision): opaque, server-side sessions.** Token = 256-bit
  random value, stored **hashed** (SHA-256) in Postgres, delivered as
  `HttpOnly; Secure; SameSite=Lax` cookie (header bearer supported for non-browser
  clients). Sliding expiration with absolute cap; device/session listing and
  remote revocation as first-class use cases.
  - _Why not stateless JWTs as the primary session:_ revocation. "Enterprise
    admin suspends a user and it takes effect _now_" is a hard requirement
    (vision persona: Daniel). Stateless tokens make that a caching problem;
    opaque sessions make it a `DELETE`. The DB lookup cost is mitigated per §12.
    Short-lived signed tokens remain appropriate for service-to-service and can
    be layered later without changing the session model.
- **Credentials:** argon2id-hashed passwords; breach-resistant reset flow
  (single-use, hashed, short-TTL tokens; no user enumeration in responses);
  rate limiting on the port level (`RateLimiter` port) for login/reset endpoints.
- **OAuth/OIDC:** authorization-code + PKCE only. Provider registry with
  reference providers (Google, GitHub, generic OIDC). External identities link to
  a user account; account-linking requires a verified email match or explicit
  user confirmation (mitigates pre-registration account takeover).
- **MFA:** TOTP with hashed recovery codes; step-up hooks so adopters (and rbac)
  can require recent-auth for sensitive operations. WebAuthn/passkeys: the port
  and model anticipate it; implementation is a fast-follow, not v1 (scope
  discipline; TOTP unblocks the enterprise checklist).
- **API keys:** prefixed (`csk_live_…`), stored hashed, org-scoped, with scopes
  drawn from rbac permissions and last-used tracking.
- All auth events (login success/failure, MFA change, key created…) are published
  — audit and notifications consume them (§6).

## 17. Authorization

- **Model: deny-by-default RBAC** evaluated _in the application layer_ — every
  protected use case declares its required permission; the check runs inside the
  use case (not only in HTTP middleware), so protection holds across every
  transport (HTTP, CLI, jobs).
- **`PolicyDecisionPort`** answers `can(subject, permission, scope) → Decision`.
  The `Decision` object carries rationale (matched role, rule) — logged to audit,
  invaluable for enterprise "why was this allowed?" forensics.
- **Two-layer defense (Decision):** authorization in application layer + tenant
  scoping in repositories (§20). Either alone is a single point of failure;
  together a missed check degrades to a tenancy-scoped mistake, not a cross-tenant
  breach.
- **Extensibility:** the decision port is the seam — adopters can wrap or replace
  the RBAC evaluator with ABAC/ReBAC engines (OPA, SpiceDB adapters are
  anticipated community territory). Core stays RBAC (§18) because 95% of B2B SaaS
  authorization is role-per-org, and relationship graphs are a different product.

## 18. RBAC

- **Concepts:** _permission_ = stable string `resource:action`
  (`billing:subscription.cancel`); _role_ = named permission set, either
  **system roles** (shipped: `owner`, `admin`, `member` baseline) or **custom
  roles** (adopter/org-defined, an entitlement-gateable feature); _assignment_ =
  (user, role, organization).
- **Scope: organization-level.** Resource-instance-level grants ("only project X")
  are out of scope for core RBAC — that is the adopter's domain or a ReBAC
  extension (§17). Trying to model everyone's resource hierarchy is the
  kitchen-sink trap named in the vision.
- **Module permission registration:** each module declares its permissions in a
  typed registry at composition time; the adopter's own permissions register the
  same way — one evaluator, one audit trail, one admin surface for both platform
  and product permissions. This is a deliberate DX win.
- **Role changes propagate via version-bump invalidation** (§12) — effective
  within one request on the same node, ≤ TTL cross-node, with security-critical
  revocations forced synchronous.

## 19. Organizations

- The `tenancy` module's `Organization` aggregate is the platform's **unit of
  tenancy, billing, and authorization scope** — one concept, consistently, across
  all modules (billing bills orgs, rbac scopes to orgs, audit partitions by org).
- Personal accounts (Decision): modeled as an auto-created personal organization —
  one code path instead of two everywhere downstream. Adopters targeting pure B2C
  can hide the concept in UI; the model stays uniform.
- Memberships carry status (invited/active/suspended); invitations are
  email-addressed, single-use, expiring tokens (hashed, per §42 rules), and work
  for not-yet-registered users (invitation → registration → auto-join flow).
- Nested organizations / org hierarchies: **deferred** (revisit by ADR when a real
  enterprise adopter needs it). Hierarchy multiplies every downstream module's
  complexity (role inheritance, billing rollups) — not before 1.0.

## 20. Multi-Tenancy

- **Model (Decision): pooled — shared database, shared schema, `organization_id`
  discriminator column on every tenant-owned table.**
  - _Why:_ it is the only model that keeps the "Node + Postgres is enough"
    promise, scales to thousands of tenants without operational machinery, and
    matches how the reference adopters (startups) actually run.
  - _Rejected as default:_ schema-per-tenant (migration fan-out, connection-pool
    fragmentation at scale) and database-per-tenant (operational cost). Both
    remain _possible_ for adopters via custom repository adapters — the ports
    don't assume pooling — and siloed-tenant guidance is documented for the
    enterprise persona.
- **Enforcement is layered (Decision):**
  1. Repository port signatures _require_ the org id for tenant-owned data —
     it is structurally impossible to call `findProjects()` without a tenant.
  2. The request `Context` carries the resolved org; interface bindings resolve
     it from the session + membership, never from client-asserted input.
  3. **Postgres Row-Level Security as defense-in-depth** (reference adapter sets
     `app.current_org` per transaction; RLS policies on tenant-owned tables).
     RLS is the backstop, not the mechanism — relying on it alone would couple
     correctness to connection-state discipline.
  4. A **mandatory cross-tenant isolation test suite** every module must pass
     (§45): every use case attempted against another tenant's data must return
     not-found/forbidden, never data.
- Tenant lifecycle: org deletion is a two-phase process (soft-delete/export
  window → hard purge job) satisfying both "undo" and GDPR erasure; every module
  registers a purge handler for its org-owned data (event-driven, §13).

## 21. Billing

- **Positioning:** billing is a _state reconciliation_ problem, not a checkout
  widget. The module owns the authoritative mirror of: plans (code-defined,
  versioned), subscriptions (state machine: trialing → active → past_due →
  canceled…), and **entitlements** — the read model the rest of the app checks
  (`entitlements.has('custom_roles')`, limits like seats).
- **`PaymentGateway` port; Stripe is the reference adapter.** Provider webhooks →
  verified, deduplicated, ordered-by-reconciliation ingestion → module state
  transition → `entitlement.changed` events. Never trust webhook payloads as
  state: every webhook triggers a fetch-and-reconcile against the provider API
  (webhooks are hints, the API is truth — this single rule eliminates the classic
  class of stale/duplicate/out-of-order webhook bugs).
- Entitlement checks are synchronous, local, and cached-by-version (§12) — a
  billing outage or provider outage **degrades to last-known entitlements**, never
  to blocked users or open gates (fail-open on limits, fail-closed on new premium
  activation; documented, configurable).
- Usage-based billing: metering port + usage records are anticipated in the model
  but post-1.0 (scope). Tax/invoicing stays in the provider (Stripe Tax) — core
  will not reimplement tax law.

## 22. Storage

- **Kernel-adjacent `FileStorage` port** (put/get/delete/signed-URL, streaming),
  with reference adapters: S3-compatible (covers AWS/R2/MinIO — one adapter, whole
  market) and local-filesystem (dev only).
- Used _by_ modules (e.g. audit exports, notification attachments) and available
  to adopters. A full "files" bounded context (per-file permissions, virus
  scanning, image pipeline) is explicitly **not core** — it's adopter domain or a
  future module proposal; the port is the 90% everyone needs.
- Rules: private-by-default buckets, signed URLs with short TTLs, content-type
  allowlisting at the port level, no public-bucket reference configuration.

## 23. Search

- **Decision: no search module in core; no `SearchPort` until two modules need
  it.** Core modules' query needs (find member by email, filter audit by actor)
  are relational lookups Postgres serves directly; audit gets Postgres full-text
  (`tsvector`) on its message field as reference implementation.
- _Why so austere:_ a search abstraction (Elastic/Meilisearch/Typesense) without a
  concrete in-core consumer would be speculative API design — the vision's
  "unused flexibility is a liability" principle. Adopter-domain search is the
  adopter's concern; documented guidance (Postgres FTS first, dedicated engine
  when relevance ranking matters) covers the common question.

## 24. Plugin System

- **Decision: modules _are_ the plugin system.** The extension surface is,
  deliberately, the same one CoreStack itself is built on:
  1. **Adapters** — implement a port, pass its contract-test suite.
  2. **Event consumers** — subscribe to published events (the integration seam
     for side-cars like CRM sync, analytics).
  3. **Third-party modules** — follow the module lifecycle contract (§8),
     register permissions/migrations/handlers like first-party modules.
  4. **Use-case decoration** — documented wrapping points for cross-cutting
     adopter concerns (extra validation, feature gating).
- **No dynamic runtime plugin loading** (marketplace-style hot install). Plugins
  are npm dependencies wired in the composition root: statically typed, reviewed,
  version-locked, supply-chain-scannable. Runtime loading is a security and
  stability tax that contradicts "boring where it counts." A registry/directory of
  community modules (vision §15) is a _discovery_ problem, not a runtime one.

## 25. API Gateway

- **Decision: CoreStack has no gateway component.** In a library platform the
  adopter's edge (their reverse proxy, their platform's ingress — nginx, Caddy,
  Vercel, an ALB) is the gateway. Shipping one would drag CoreStack into
  operating-model opinions the vision explicitly refuses (hosting is out of
  scope).
- What core provides instead: rate-limiting via `RateLimiter` port enforced at
  use-case level (so it holds regardless of edge), standard health/readiness
  endpoints, and documented edge guidance (TLS, IP allowlists for webhooks,
  proxy-header trust configuration — `trustProxy` explicit, never inferred).

## 26. REST API

- **Interface bindings expose module use cases as resource-oriented REST**
  (Hono reference binding, §10): plural nouns, standard verbs,
  `/v1/organizations/{orgId}/members` style; org scope always explicit in paths
  for auditability and cache-key clarity.
- **Errors: RFC 9457 `application/problem+json`**, with `code` = the kernel
  `CoreError` code (`core/forbidden`, `auth/mfa_required`). One mapping table,
  stable codes, no leaked internals (§42).
- **Pagination: cursor-based everywhere** (opaque cursors); offset pagination is
  not offered (it breaks under concurrent writes and invites deep-scan abuse).
- **Idempotency-Key support on billing and webhook-management mutations**
  (stored key → response replay), because networks retry and money doubles badly.
- **Versioning: URL major (`/v1`)** — boring, cache-friendly, obvious in logs;
  header-based versioning rejected as invisible and error-prone.
- **OpenAPI 3.1 generated from the same Zod schemas** that validate requests
  (single source of truth; the spec cannot drift from behavior) — feeding docs
  and SDK generation (§28).

## 27. GraphQL

- **Decision: not in core.** Reasons: (1) CoreStack's API surface is command-heavy
  (use cases) not graph-query-heavy; (2) GraphQL's real costs — resolver N+1
  discipline, query-depth/complexity limiting, per-field authorization — are
  exactly the security-sensitive machinery we'd rather not double-maintain beside
  REST; (3) the typed SDK (§28) already gives frontend DX that is GraphQL's main
  selling point here.
- Because use cases are transport-agnostic, a GraphQL binding is a _clean
  community adapter_ (resolvers → use cases); the door is architecturally open,
  the maintenance commitment deliberately not made.

## 28. SDK Strategy

- **Server-side: the modules are the SDK.** Adopters import use cases directly —
  fully typed, no HTTP hop, no codegen. This is the platform's primary DX.
- **Client-side (`@corestack/client`): a typed HTTP client generated from the
  OpenAPI spec** for browsers/mobile/external consumers — auth/session helpers,
  typed errors mirroring the taxonomy, framework-agnostic core with thin React
  hooks package later. Generated (not hand-written) so it can never lag the API.
- **Other languages:** post-1.0, generated from the same OpenAPI source
  (vision §15) — Python and Go first, demand-driven. Contract-first generation is
  the only sustainable multi-language strategy for a small team.

## 29. CLI Strategy

- **`@corestack/cli` (`corestack …`) is an operator convenience layer** over
  module APIs — never the only way to do anything (CI environments script against
  the same APIs).
- v1 command set: `init` (scaffold composition root + config), `migrate`
  (compose/apply module migrations, §11), `doctor` (validate config, connectivity,
  pending migrations, common misconfigurations — the support-load killer),
  `generate` (typed clients, OpenAPI export), `dev` seeds/fixtures.
- Non-interactive by default with `--json` output (agent- and CI-friendly);
  interactive prompts only on TTY. Built on the same config validation as runtime
  (§8) so CLI and app can never disagree about configuration.

## 30. Logging

- **Kernel `Logger` port** (leveled, structured, child-logger context binding);
  modules log through it exclusively — never `console`. Reference adapter: pino
  (JSON to stdout, the 12-factor contract; aggregation is the platform's job, not
  ours).
- **Redaction is not optional (Decision):** the port's reference adapters apply a
  deny-list serializer (secrets, tokens, passwords, full emails in favor of
  hashed/masked forms) and modules must never pass secrets to the logger at all —
  enforced by review checklist + a lint rule banning known-sensitive identifiers
  in log call sites.
- Every log line carries: module, correlation id, org id (when tenant-scoped),
  actor id. Correlation ids originate at the interface binding and flow through
  `Context` — one request is one traceable thread across use cases, events, jobs.

## 31. Monitoring

- **Modules expose OpenTelemetry-API instrumentation** (spans around use cases,
  adapter calls; counters/histograms for the metrics below). OTel API only — the
  SDK/exporter choice (Prometheus, OTLP to any vendor) belongs to the adopter;
  no vendor agent is ever bundled.
- **Golden signals shipped per module by default:** use-case latency/error-rate,
  outbox lag & dead-letter depth (§13), job queue depth/age (§14), webhook
  delivery failure rate (§6), login failure & rate-limit trip rates (§16). These
  are the metrics that page someone usefully at 3 a.m.
- Health endpoints: liveness (process) and readiness (DB reachable, migrations
  current, outbox relay running) — standardized shape across all deployments.

## 32. Observability

Logs (§30) + metrics/traces (§31) unified by **one correlation model**:
`correlation_id` (request/journey) and `causation_id` (what directly caused this)
propagate through use cases → events → outbox → jobs → webhook deliveries.
**Decision:** this propagation is part of the event/job envelope contract (§13),
not an add-on — retrofit-impossible, so designed-in. Result: "show me everything
that happened because user X clicked invite" is a single-id query across any
adopter's observability stack. Audit (§6) covers the _compliance_ view; OTel covers
the _operational_ view; both hang off the same ids.

## 33. Feature Flags

- Consistent with the vision (deferred module): **core ships no flag engine.**
- What exists instead now: (1) module config toggles (validated, boot-time — §8)
  for platform behavior; (2) billing **entitlements** (§21) — which are the
  _product-tier_ flags most SaaS actually needs and already have a full module;
  (3) a minimal `FlagPort` seam used internally where runtime toggling is
  genuinely required, satisfiable by adopters with env/config or any flag vendor.
- Rationale: entitlements ≠ experiments. Percentage rollouts/experimentation is a
  mature vendor market (and a possible post-1.0 module) — wrapping it prematurely
  adds API surface without differentiated value.

## 34. CI/CD

- **GitHub Actions** (where the community is), with turbo remote caching.
- **PR pipeline:** lint + boundary rules → typecheck → unit tests → integration
  tests (Postgres/Redis service containers) → contract-test suites → build →
  docs build. Merge queue on `main`; `main` is always releasable.
- **Security lane (every PR + nightly):** CodeQL, dependency audit + Renovate,
  secret scanning, license check (MIT-compat allowlist).
- **Release pipeline:** Changesets version PR → tag → build → **npm publish with
  provenance attestation** (Sigstore) from CI only — no human-machine publishes;
  registry 2FA + granular tokens. Supply-chain integrity is a headline feature
  for a security platform, not hygiene.
- **Isolation-suite gate:** the cross-tenant test suite (§20) is a required check
  that cannot be skipped by any label or admin merge. Some gates deserve to be
  unskippable.

## 35. Infrastructure

- **The platform's own infrastructure is deliberately minimal:** GitHub (code,
  CI, discussions), npm (distribution), a static docs site, and a status-less
  everything-else. No servers to run means no servers to breach or fund — the
  project's continuity depends only on commodity, replaceable services (§40).
- **Adopter-facing infrastructure is guidance + reference assets, not product**
  (§36–39): CoreStack must run identically on a $5 VPS, Fly.io, ECS, Kubernetes,
  or Vercel-style platforms (Node runtime + Postgres reachable = supported).

## 36. Deployment

- **Unit of deployment: the adopter's application** (CoreStack inside). Two
  process roles from one build: `web` and `worker` (§2, §14) — role selection via
  env, so every platform's process model (Procfile, k8s Deployment, systemd) maps
  cleanly.
- **Zero-downtime upgrade contract (Decision):** every CoreStack release is
  N/N+1 compatible — old code runs against new schema (expand-and-contract
  migrations, §11), so the documented order is: migrate → rolling deploy. Health/
  readiness endpoints (§31) gate rollout. This contract is tested in CI (previous
  minor's tests against current schema).
- Configuration via environment only (validated at boot, §8); no config files in
  images; secrets from the platform's secret store — never baked, never logged.

## 37. Docker

- **Reference `Dockerfile` (in the reference app) as documentation-grade
  artifact:** multi-stage (pnpm fetch → build → distroless/slim runtime),
  non-root user, read-only filesystem, pinned base images, healthcheck, SBOM
  emitted at build. It demonstrates the standard we recommend; adopters own their
  images.
- **`docker-compose.dev.yml`** for the local stack (Postgres, Redis-optional,
  MinIO-optional, mail-catcher) — one command to a working dev environment is
  part of the first-hour DX budget (vision NFR-6).
- CoreStack publishes **no runtime images of its own** (nothing to run standalone);
  CI images for contract testing are internal.

## 38. Kubernetes

- **Position: fully supported target, never a requirement.** The vision's
  personas mostly should _not_ run k8s; the enterprise persona (Marcus) already
  does. Both are served: statelessness, role-split processes, health probes,
  graceful shutdown (SIGTERM → drain jobs/outbox relay) are designed-in (§36) —
  that's what makes any orchestrator work.
- **Reference Helm chart for the reference app** (Deployment ×2 roles, HPA
  examples, PodDisruptionBudgets, NetworkPolicy, ServiceMonitor) maintained as
  _documented example_, not a supported product surface — clearly labeled, because
  chart-as-product is a maintenance tarpit orthogonal to the platform's value.
- No operator/CRDs: CoreStack has no control-plane state to reconcile; an
  operator would be complexity theater.

## 39. Terraform

- **Reference Terraform modules as examples** (one per major target: AWS
  ECS+RDS, GCP CloudRun+CloudSQL, Hetzner/VPS+managed PG) living in
  `examples/terraform/*` — same "documentation-grade, not product" status as the
  Helm chart, same rationale.
- The platform's own (minimal, §35) infrastructure — repo settings, npm org, DNS —
  is itself managed as code in a private ops repo from day one: practicing what we
  document, and bus-factor insurance.

## 40. Cloud Strategy

- **Cloud-agnostic by construction:** the only hard external dependencies are a
  Node runtime and PostgreSQL; everything else (mail, storage, queues, cache) is
  an optional port. Every port has at least one self-hostable reference adapter —
  **the platform is fully operable with zero proprietary cloud services**, which
  is the enterprise/data-residency story (Marcus) and the anti-lock-in promise in
  one move.
- Managed-service guidance (Neon/RDS/CloudSQL/Supabase for Postgres; R2/S3 for
  storage; Resend/SES for mail) is documentation, with the trade-offs stated —
  we recommend boring managed Postgres for most adopters and feel no shame.
- CoreStack Cloud (vision §18) would be _built on these same ports_ — the
  commercial product proves the abstractions rather than bypassing them.

## 41. Disaster Recovery & Scalability

**DR (adopter guidance, shipped as runbook documentation):**

- Postgres is the single source of truth → DR = Postgres DR: PITR + tested
  restores (untested backups are wishes); documented RPO/RTO tiers (e.g.
  managed-PG defaults: RPO ≤ 5 min, RTO ≤ 1 h).
- Outbox (§13) makes post-restore event/webhook/notification recovery
  deterministic: relay resumes from checkpoints; idempotent consumers absorb
  replays. Payment truth is reconcilable from the provider (§21) — by design,
  every external side effect is either replayable or reconcilable.
- Project-side DR: git is distributed, npm is immutable-versioned, CI is
  rebuildable from the repo (§35, §39) — the project survives the loss of any
  single account or laptop.

**Scalability (the honest ladder, documented with the numbers to expect):**

1. One node (web+worker) + Postgres — comfortably serves most B2B SaaS to
   thousands of orgs.
2. Horizontal web/worker scaling (stateless, §36) + Redis cache/queue adapters
   when Postgres queue polling becomes the bottleneck (§14).
3. Postgres: connection pooling (PgBouncer guidance), read replicas for read
   models, table partitioning where data is naturally append-only (audit events,
   outbox, webhook deliveries — partitioned by month from day one in reference
   schemas, because retrofitting partitioning hurts).
4. Module extraction to services — enabled by events + no cross-module FKs +
   per-module schemas; explicitly a supported path, deliberately not the default.

## 42. Security Model

The platform-wide model; each module additionally ships its own threat model (§8).

- **Trust boundaries:** internet ↔ interface bindings; app ↔ Postgres; app ↔
  third-party providers (mail, payments, OAuth); adopter code ↔ CoreStack modules
  (a _supported_ boundary: adopter bugs shouldn't corrupt platform state —
  hence invariant-enforcing aggregates and validated use-case inputs everywhere,
  even from "trusted" server-side callers).
- **Authentication of every actor type:** end users (§16), services/API keys
  (§16), webhook sources (signature verification + timestamp windows, §21),
  webhook destinations (HMAC-signed deliveries with rotatable secrets, §6).
- **Secrets doctrine:** no secret is ever stored or logged in recoverable form
  (argon2id for passwords; SHA-256 for high-entropy tokens); secrets in env via
  validated config; reference adapters support KMS-style secret refs; key
  rotation procedures documented per secret class.
- **Injection defense:** parameterized queries only (Drizzle enforces),
  Zod boundary validation (ADR-0005), output encoding owned by interface
  bindings, `problem+json` errors that never leak internals (§26).
- **Tenant isolation:** the layered model of §20 — structural scoping + context
  resolution + RLS backstop + unskippable isolation test suite (§34).
- **OWASP ASVS L2** is the tracked baseline (vision NFR-1), with an external
  audit gate before auth/tenancy 1.0 (vision roadmap).
- **Supply chain:** §34's lane (provenance publishes, pinned deps, scanning) plus
  minimal-dependency policy — every new runtime dependency needs justification in
  PR description; the kernel has zero.
- **Vulnerability handling:** private reporting (SECURITY.md), 72 h
  acknowledgment, coordinated disclosure, < 7-day median patch (vision metric),
  backports to the supported version line.

## 43. Performance Strategy

- **Budgets are requirements** (vision NFR-3): session validation and policy
  checks ≤ 5 ms p95 (excluding network); use-case overhead (validation, context,
  event write) ≤ 2 ms p95; no released endpoint without pagination on unbounded
  sets.
- **Design-time enforcement:** every module design review includes its query
  plan sketch (indexes declared with the schema, no N+1 by construction —
  repository methods fetch aggregates whole); hot paths (session lookup, policy
  check, entitlement check) get microbenchmarks that run in CI with regression
  thresholds — performance regressions fail PRs like test failures, because
  post-hoc "performance sprints" are how platforms get slow forever.
- **Runtime posture:** measure before caching (§12); OTel histograms (§31) make
  every adopter a performance data point; the reference app is load-tested per
  release (k6) with published numbers — public numbers keep us honest and are
  marketing that can't be faked.

## 44. Testing Strategy

Five layers, each answering one question:

1. **Domain unit tests** (no I/O, milliseconds) — "are the business rules
   right?" Vision target ≥ 90% coverage on domain/application — reachable
   because these layers have no infrastructure excuses.
2. **Application tests with in-memory fakes** — "do use cases orchestrate,
   authorize, and emit correctly?" Fakes (not mocks) per port, shipped in each
   module's test kit so adopters test _their_ code the same way.
3. **Port contract-test suites (the keystone, Decision)** — every port publishes
   an abstract test suite; every adapter — first-party, community, or
   adopter-written — runs the identical suite against real infrastructure
   (Testcontainers: Postgres, Redis, MinIO). This is what makes "swap anything"
   _verifiable_ rather than promised, and it's the certification bar for
   community adapters (§24).
4. **Composition/E2E tests** — the reference app exercised through real HTTP for
   golden journeys (register → org → invite → role → subscribe → audit trail).
   Deliberately few and deliberately these.
5. **Adversarial suites:** the cross-tenant isolation suite (§20, unskippable);
   authorization matrix tests (every use case × every baseline role); crash-
   consistency tests for the outbox (kill the process mid-use-case, assert no
   lost/duplicated effects after restart).

No mutation-testing/fuzzing mandate for v1 (fuzzing targeted at parsers —
webhook signature verification, cursor decoding — is the pragmatic subset we do
adopt). Test speed is a feature: unit+application must stay < 30 s repo-wide or
contributors stop running them.

## 45. Folder Structure

Normative layout inside every module package (the uniformity itself is the
feature — learn one module, know them all):

```
packages/<module>/
  src/
    domain/            entities, value-objects, events, domain services
    application/
      use-cases/       one file per use case
      ports/           repository + gateway interfaces
      dto/             input/output shapes
    infrastructure/
      postgres/        schema, migrations/, repositories
      <vendor>/        other reference adapters (stripe/, smtp/, …)
    interface/
      http/            transport-neutral route defs + Hono binding
      schemas/         Zod boundary schemas
    index.ts           public surface (application only)
  test/
    domain/  application/  contract/  integration/
  docs/                glossary.md, threat-model.md, decisions/
  package.json         exports: ".", "./postgres", "./hono", "./testing"
```

## 46. Repository Structure

```
CoreStack/
  packages/            publishable @corestack/* packages (kernel + modules + cli + client)
  apps/
    reference-nextjs/  reference application (never published)
  tooling/             shared tsconfig/eslint presets, contract-test kit, benchmarks
  examples/            terraform/, helm/, compose/ — documentation-grade assets (§37–39)
  docs/
    product/           VISION.md
    architecture/      this document, overview.md, deeper design notes
    adr/               numbered ADRs (the decision log)
    runbooks/          DR, upgrade, incident guidance (§41)
  .github/             workflows (PR, security, release), issue/PR templates
  turbo.json  pnpm-workspace.yaml  tsconfig.base.json  package.json
```

## 47. Package Structure

The dependency graph between packages — arrows are the _only_ permitted
directions, machine-enforced (§4):

```
                          @corestack/kernel
                                 ▲
                          @corestack/platform (composition root, migrations,
                                 ▲              outbox — I/O-capable, unlike kernel)
        ┌──────────┬─────────┬───┴────┬──────────┬─────────────┐
      auth      tenancy    rbac    billing     audit    notifications/jobs/webhooks
        ▲          ▲         ▲        ▲          │  (modules depend ONLY on kernel
        └──────────┴────┬────┴────────┘          │   + platform; cross-module =
                        │                        │   events + ids, never package
                @corestack/cli, @corestack/client, apps/reference-nextjs   imports*)
                (composition consumers — may depend on any module)
```

**`@corestack/platform` is a second shared dependency base** (ADR-0016,
added after this section was first drafted): it houses the composition
root, migration engine, and transactional outbox — infrastructure every
module needs but that cannot live in the runtime-agnostic, zero-dependency
kernel. Platform itself depends only on kernel, preserving the inward-only
shape of the graph.

\* The one nuance: modules may depend on another module's **published contract
types** (event/DTO types re-exported through a `@corestack/<module>/contracts`
subpath) — types only, no runtime import. This keeps compile-time safety for
event consumption without runtime coupling (type-level dependency, runtime
independence).

## 48. Decision Register & Next Steps

New ADRs to be written upon approval of this document (the hard-to-reverse
subset): opaque sessions over JWT (§16), pooled multi-tenancy with layered
enforcement (§20), transactional outbox + no event sourcing (§13), adapters as
subpath exports (§7), Postgres-backed queue default (§14), REST-only core API
(§26–27), no runtime plugin loading (§24), module lifecycle contract (§8),
zero-downtime N/N+1 upgrade contract (§36).

**Stopping here, per instruction.** Next phase upon approval: formal requirements
specification and detailed design for the identity core (`tenancy`, `auth`) —
still before implementation.
