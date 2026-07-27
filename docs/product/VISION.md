# CoreStack — Product Vision Document

- **Status:** Draft, awaiting founder approval
- **Version:** 0.1
- **Date:** 2026-07-28
- **Owners:** CoreStack founding team

---

## 1. Executive Summary

CoreStack is an open-source, modular platform that provides the production-grade
foundations every SaaS application needs — authentication, organizations and
multi-tenancy, role-based access control, billing, audit logging, background jobs,
notifications, and webhooks — as independently adoptable, independently upgradeable
TypeScript packages built on Clean Architecture.

Today, every SaaS team rebuilds the same undifferentiated plumbing, or accepts one of
two flawed shortcuts: **starter-kit templates** they fork once and then own forever
(no upgrades, no security patches), or **backend-as-a-service products** that trade
control, data ownership, and extensibility for convenience. CoreStack takes a third
path: a _platform of versioned modules_ that teams install, configure, and upgrade
like any dependency — while their domain logic, their database, and their deployment
remain entirely their own.

The opportunity is the same one Laravel seized for PHP, Supabase for Postgres, and
Kubernetes for infrastructure: an enormous, underserved population of teams doing
repetitive, security-critical work by hand. CoreStack aims to become the default
answer to "how do we build the SaaS parts of our SaaS" in the TypeScript ecosystem —
the largest application-development ecosystem in the world.

## 2. Vision

**A world where no SaaS team ever rebuilds authentication, tenancy, or billing again
— and never gives up ownership of their product to avoid it.**

Five years from now, "we run on CoreStack" should communicate the same thing "we run
on Rails" once did: the undifferentiated 80% is handled, hardened, and maintained by
a global community, so the team's entire creative energy goes into the 20% that makes
their product unique.

## 3. Mission

To build and maintain the open-source standard for production-ready SaaS
foundations: secure by default, modular by design, owned by its users, and
excellent enough that choosing anything else requires justification.

## 4. Project Goals

1. **Eliminate rebuilt plumbing.** Ship modules covering the recurring 80% of every
   B2B/B2C SaaS: auth, tenancy, RBAC, billing, audit, notifications, jobs, webhooks.
2. **Upgrades, not forks.** Every module is a versioned package with semver
   discipline and documented migrations. Adopters upgrade; they never fork.
3. **Ownership without compromise.** Adopters keep their database, their
   infrastructure, their data, and full source visibility. No hosted dependency is
   ever required.
4. **Security as a product feature.** The secure path is the default path in every
   module, verified by tests and independent review.
5. **World-class developer experience.** From `pnpm add` to a working, secure,
   multi-tenant app in under one hour, with documentation that equals or exceeds
   Laravel's and Supabase's.
6. **A self-sustaining community.** Governance, contribution ladders, and a plugin
   ecosystem that outlive the founding team.

## 5. Project Principles

1. **A platform, not a template.** If adopting a feature requires copying code into
   the user's repo, we have failed at that feature.
2. **The domain belongs to the adopter.** CoreStack provides bounded contexts around
   generic SaaS concerns; it never absorbs or dictates the adopter's business domain.
3. **Modular to the core.** Every module is useful alone and better together. No
   module may require another except the kernel.
4. **Swap anything.** Databases, mail providers, payment processors, HTTP frameworks
   are adapters behind ports. Reference implementations are provided; lock-in never is.
5. **Secure by default, configurable with friction.** Insecure configurations must be
   possible only explicitly, visibly, and loudly.
6. **Boring where it counts.** Proven technology, explicit code, no magic. Surprise
   is a defect.
7. **Documentation is part of the definition of done.** Undocumented features do not
   ship.
8. **Decisions are written down.** Every hard-to-reverse choice gets an ADR before
   the code.

## 6. Problems CoreStack Solves

| #   | Problem                                        | Status quo                                                                     | CoreStack's answer                                                            |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1   | Every SaaS rebuilds auth, orgs, roles, billing | 2–6 months of undifferentiated engineering per company                         | Install versioned modules; configure, don't rebuild                           |
| 2   | Starter kits rot                               | Forked templates never receive security patches or improvements                | Modules upgrade like dependencies, with migration guides                      |
| 3   | BaaS lock-in                                   | Data, auth flows, and pricing controlled by a vendor; extensibility capped     | Self-hosted packages over the adopter's own database                          |
| 4   | Security is DIY                                | Token storage, session fixation, tenant isolation left to each team's judgment | Hardened defaults, hashed secrets, enforced tenant scoping, audit trail       |
| 5   | Multi-tenancy is retrofitted                   | Tenancy added after product-market fit, painfully                              | Tenancy as a first-class module from day one                                  |
| 6   | Billing integration is fragile                 | Ad-hoc Stripe webhooks, entitlements smeared through the codebase              | A billing module owning subscriptions and entitlements behind a provider port |
| 7   | Compliance evidence is scattered               | Audit trails bolted on before enterprise deals                                 | Append-only audit module fed by domain events from every module               |

## 7. Target Users

- **Primary:** TypeScript teams (1–50 engineers) building B2B or B2C SaaS products —
  from solo founders to Series-B startups.
- **Secondary:** Agencies and consultancies delivering SaaS products for clients,
  who need a repeatable, supportable foundation across projects.
- **Tertiary:** Enterprises building internal platforms or spin-off products who
  need self-hosted, auditable foundations that pass security review.
- **Ecosystem:** Open-source contributors, adapter authors, and infrastructure
  vendors (databases, email, payments) who benefit from a standard port to plug into.

## 8. User Personas

### Persona 1 — "Amara", solo technical founder

- **Context:** Ex-FAANG engineer building a B2B analytics product nights and weekends.
- **Goal:** Reach a paying customer in 8 weeks; spend zero time on plumbing.
- **Pain:** Auth + orgs + Stripe took longer than her actual product last attempt.
- **CoreStack promise:** Working multi-tenant app with subscriptions in a weekend,
  on infrastructure she owns, at $0 platform cost.

### Persona 2 — "Daniel", startup CTO (12 engineers, Series A)

- **Context:** Product found market fit; now enterprise prospects demand SSO, RBAC,
  audit logs, and a security questionnaire.
- **Goal:** Ship enterprise readiness without pausing the product roadmap.
- **Pain:** The team's home-grown auth can't grow these features safely; a rewrite is
  unaffordable.
- **CoreStack promise:** Incremental adoption — put CoreStack auth/RBAC/audit beside
  the existing system, migrate module by module, upgrade forever after.

### Persona 3 — "Priya", agency technical lead

- **Context:** Delivers 4–6 client SaaS builds per year with a small team.
- **Goal:** A standard foundation across all client projects that clients can be
  handed with confidence.
- **Pain:** Each project reinvents the base; handovers of bespoke auth code are a
  liability.
- **CoreStack promise:** One documented, upgradeable foundation across every
  project; clients inherit maintained open source, not orphaned bespoke code.

### Persona 4 — "Marcus", enterprise platform engineer

- **Context:** Builds internal developer platforms at a 3,000-person company;
  everything must pass security and legal review.
- **Goal:** Approved, self-hosted building blocks his internal teams can compose.
- **Pain:** SaaS vendors fail data-residency review; internal frameworks rot.
- **CoreStack promise:** MIT-licensed, auditable source, runs entirely inside his
  perimeter on his Postgres, with a stable upgrade path and (eventually) commercial
  support available.

### Persona 5 — "Yuki", open-source contributor

- **Context:** Mid-career engineer who wants meaningful OSS impact.
- **Goal:** Contribute to a project with clear architecture and welcoming governance.
- **Pain:** Most projects have opaque cores and drive-by maintainership.
- **CoreStack promise:** Documented architecture, ADRs explaining every decision,
  a contribution ladder from adapter authorship to module maintainership.

## 9. Product Scope

### In scope (the platform)

- **Kernel:** shared contracts — results, errors, clock/id/event ports.
- **Modules (bounded contexts):**
  - _Auth_ — credentials, sessions, OAuth/OIDC, MFA, password reset, API keys
  - _Tenancy_ — organizations, memberships, invitations, tenant isolation
  - _RBAC_ — roles, permissions, policy evaluation
  - _Billing_ — plans, subscriptions, entitlements, provider adapters (Stripe first)
  - _Audit_ — append-only event trail with query API
  - _Notifications_ — templated email/in-app messages behind provider ports
  - _Jobs_ — background work and scheduling behind queue ports
  - _Webhooks_ — signed outbound event delivery with retries
- **Reference adapters:** PostgreSQL persistence; one reference each for mail,
  payments, and queues.
- **Reference application:** a Next.js starter proving the composition end to end.
- **Documentation:** guides, API reference, architecture docs, migration guides.

### Out of scope (permanently, by principle)

- The adopter's business domain (CRM objects, project boards, analytics, etc.)
- UI component libraries beyond the minimal reference app
- Hosting, deployment orchestration, or infrastructure provisioning
- A proprietary hosted control plane required for operation
- Non-TypeScript SDK surfaces (until the core is stable; revisit post-1.0)

### Out of scope (initially, revisit by ADR)

- Databases other than PostgreSQL as _reference_ implementations
- Real-time/collaboration primitives
- Feature flags module (candidate for post-1.0)

## 10. Functional Requirements

_High-level; each module receives a full requirements specification before its
design phase. "Adopter" = the developer/team using CoreStack; "end user" = their user._

- **FR-1 Authentication.** End users can register, authenticate (password, OAuth
  providers, and TOTP MFA), maintain sessions, reset credentials, and be
  administratively suspended. Adopters can issue and revoke API keys.
- **FR-2 Tenancy.** End users can create organizations, invite members by email,
  accept/decline invitations, and switch between organizations. Every
  tenant-owned record is isolated by organization.
- **FR-3 Access control.** Adopters can define roles and permissions; the platform
  evaluates policy checks in application code and exposes the decision rationale.
- **FR-4 Billing.** Organizations can subscribe to plans, change plans, and have
  entitlements enforced in application code; payment provider state is reconciled
  via webhooks.
- **FR-5 Audit.** Every security-relevant action across all modules emits an
  immutable audit event, queryable by organization, actor, action, and time range.
- **FR-6 Notifications.** Modules and adopter code can send templated messages
  through configured channels without knowing the provider.
- **FR-7 Jobs.** Adopter code can enqueue, schedule, and retry background work
  through a queue-agnostic API.
- **FR-8 Webhooks.** Adopters can register endpoints; the platform delivers signed
  domain events with retries and a delivery log.
- **FR-9 Composition.** Any subset of modules can run together; cross-module
  behavior (e.g. audit capturing auth events) works through events, not imports.
- **FR-10 Observability hooks.** Every module exposes structured logs and metrics
  through pluggable interfaces.

## 11. Non-Functional Requirements

- **NFR-1 Security.** OWASP ASVS Level 2 alignment for auth flows; secrets stored
  only hashed; tenant isolation enforced on every data path and covered by tests;
  documented threat model per module; coordinated disclosure process.
- **NFR-2 Reliability.** Modules make failure modes explicit (typed results);
  webhook/billing reconciliation is idempotent; no module loses data on crash.
- **NFR-3 Performance.** Policy checks and session validation add ≤ 5 ms p95
  overhead on commodity hardware; no N+1 query patterns in reference adapters.
- **NFR-4 Compatibility.** Node.js LTS floor; semver with documented, mechanical
  migration guides for every breaking change; deprecations live one minor version
  before removal.
- **NFR-5 Extensibility.** Every external dependency sits behind a documented port;
  writing a custom adapter requires no changes to CoreStack source.
- **NFR-6 Developer experience.** New project to authenticated multi-tenant "hello
  world" in under one hour following only the docs; every public API has reference
  documentation and a usage example.
- **NFR-7 Quality.** ≥ 90% coverage on domain/application layers; adapters covered
  by integration tests against real services in CI; zero `any` in public APIs.
- **NFR-8 Operability.** All modules run in a single process by default; horizontal
  scaling requires no code changes; configuration via environment with validated
  schemas.

## 12. Success Metrics

| Horizon   | Metric                                                                               | Target        |
| --------- | ------------------------------------------------------------------------------------ | ------------- |
| 6 months  | Working modules released (kernel, tenancy, auth)                                     | 3             |
| 6 months  | GitHub stars / weekly npm downloads                                                  | 2,000 / 1,000 |
| 6 months  | Time-to-first-production-app (docs-only test)                                        | < 1 day       |
| 12 months | Modules at 1.0 API stability                                                         | 5+            |
| 12 months | Production deployments (self-reported telemetry opt-in)                              | 200+          |
| 12 months | External contributors with merged PRs                                                | 50+           |
| 12 months | Community adapters (non-core maintained)                                             | 10+           |
| 24 months | "Default choice" signal: CoreStack in mainstream "how to build a SaaS in TS" content | Qualitative   |
| Always    | Critical security vulnerabilities exploited in the wild                              | 0             |
| Always    | Median time from security report to patched release                                  | < 7 days      |

## 13. Risks

| Risk                                                                     | Likelihood | Impact | Mitigation                                                                                                                                         |
| ------------------------------------------------------------------------ | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope creep into a kitchen-sink framework**                            | High       | Fatal  | "Out of scope permanently" list above; every module addition requires an ADR against the principles                                                |
| **The 80% is subtly different per company** — modules too rigid to adopt | Medium     | High   | Ports/extension points designed from real adopter interviews; incremental-adoption story is a first-class requirement                              |
| **Security failure in a security product**                               | Medium     | Severe | Threat models, ASVS alignment, external audit before auth 1.0, disclosure process from day one                                                     |
| **Maintainer burnout / bus factor**                                      | High       | High   | Small kernel, module ownership distribution, contribution ladder, commercial sustainability path (§18)                                             |
| **Competition:** better-auth, Clerk, Supabase expanding sideways         | High       | Medium | Differentiation is the _integrated, self-hosted, modular whole_ — no competitor offers upgradeable tenancy+RBAC+billing+audit on your own database |
| **Ecosystem shift** (runtime/framework churn in JS)                      | Medium     | Medium | Runtime-agnostic core (no Node builtins in domain/application); frameworks are adapters                                                            |
| **Breaking-change churn erodes trust pre-1.0**                           | Medium     | High   | Honest 0.x labeling, changelogs and migration notes from the first release                                                                         |
| **Community never materializes**                                         | Medium     | High   | Docs-first culture, public roadmap, fast first-PR experience measured and optimized                                                                |

## 14. Roadmap Overview

_Phases gate on quality, not dates. Dates are planning targets, not promises._

- **Phase 0 — Foundation (now).** Vision (this document), architecture, ADRs,
  monorepo, kernel contracts, CI, contribution infrastructure.
- **Phase 1 — Identity core (target: +4 months).** `tenancy` and `auth` modules with
  Postgres adapters, first security review, docs site, first public 0.x releases.
- **Phase 2 — Control plane (target: +8 months).** `rbac` and `audit`; the
  cross-module event story proven in production shape.
- **Phase 3 — Revenue (target: +12 months).** `billing` (Stripe reference adapter),
  `webhooks`, `notifications`, `jobs`; Next.js reference application.
- **Phase 4 — Stabilization (target: +15–18 months).** External security audit,
  API freeze, migration tooling, **1.0** for the identity core; launch communications.
- **Continuous:** documentation, community building, adapter ecosystem.

## 15. Long-Term Vision

- **The standard port surface.** CoreStack's ports (persistence, mail, payments,
  queues) become interfaces third parties target directly — vendors ship their own
  CoreStack adapters the way they ship Terraform providers today.
- **An ecosystem, not just a codebase.** A registry of community modules and
  adapters with clear certification tiers (core / verified / community).
- **Beyond TypeScript-first.** Once module contracts are stable, protocol-level
  definitions enable additional language SDKs — without ever compromising the
  TypeScript experience that comes first.
- **The compliance dividend.** Because audit, RBAC, and tenancy are uniform,
  SOC 2 / ISO evidence generation becomes a feature adopters get nearly for free.
- **Generational sustainability.** A governance structure (foundation or
  stewardship company) that guarantees CoreStack outlives its founders' involvement.

## 16. Open Source Strategy

- **License:** MIT for everything in the core repository, permanently (ADR-0006).
  The core will never be relicensed to source-available.
- **Development in the open:** roadmap, RFCs, ADRs, and issue triage are public.
  There is no private fork where the real work happens.
- **RFC process:** substantial features start as public RFCs; module designs are
  reviewable before implementation.
- **Release discipline:** semver, signed releases, changelogs, and migration guides
  as non-negotiable release criteria.
- **No CLA; DCO instead.** Inbound = outbound under MIT keeps contribution friction
  minimal and signals the core will stay free.
- **Vendor neutrality:** reference adapters may feature specific vendors (Stripe,
  Postgres) for excellence, but ports guarantee no vendor is structurally
  privileged.

## 17. Community Strategy

- **Docs as the front door.** The documentation site is the primary product surface;
  its quality is a stated competitive weapon.
- **The first hour and the first PR.** Two funnels measured and optimized
  relentlessly: time-to-working-app for adopters, time-to-merged-PR for
  contributors ("good first issue" curation, CONTRIBUTING quality, review SLAs).
- **Contribution ladder:** user → issue reporter → adapter author → module
  contributor → module maintainer, with each rung documented and achievable.
- **Communication:** GitHub Discussions for design and support; a public community
  chat; a monthly written changelog/devlog for reach.
- **Recognition:** contributors credited in release notes; community adapters
  listed in official docs.
- **Code of conduct** enforced consistently from day one.

## 18. Commercial Possibilities

_Documented now so the community is never surprised later. None of these gate or
degrade the MIT core; the open-source project must be excellent and complete on its
own._

1. **CoreStack Cloud (most likely path).** Managed hosting of CoreStack-based
   backends — the Supabase/GitLab model: the product is convenience and operations,
   not withheld features.
2. **Enterprise modules.** Separately licensed packages for organization-scale
   needs the community core doesn't require: SCIM provisioning, advanced SSO (SAML),
   compliance report generation, admin consoles.
3. **Support and services.** SLAs, upgrade assistance, and architecture review for
   enterprises; certification for agencies (the Priya persona) building on CoreStack.
4. **Marketplace revenue share (long-term).** If the adapter/module registry
   matures, certified commercial listings.

**Explicit non-possibilities:** relicensing the core, open-core hollowing (moving
existing free features behind a paywall), and telemetry without opt-in consent.

## 19. Guiding Engineering Principles

1. **Design first.** Vision → requirements → module design/ADR → implementation.
   Skipping a step is how platforms rot.
2. **The dependency rule is law.** Domain depends on nothing; application depends on
   domain; infrastructure and interface depend inward. Enforced by tooling, not
   vigilance.
3. **Expected failures are values, unexpected failures throw.** Typed results at
   every use-case boundary; no exception-driven control flow.
4. **Every boundary is validated.** Nothing unvalidated crosses from the outside
   world into a use case.
5. **Tests are the specification.** Domain and application behavior is fully tested
   without I/O; adapters are tested against real infrastructure.
6. **Semver is a promise, not a suggestion.** Breaking changes are rare, batched,
   documented, and mechanically migratable.
7. **Optimize for the reader.** Code is written once and read for a decade; clarity
   beats cleverness everywhere.
8. **Performance is designed, not patched.** Data-access patterns are reviewed at
   design time; no released module ships known N+1s or unbounded queries.
9. **Delete ruthlessly.** Unused flexibility is a liability. We build extension
   points adopters need, not ones we can imagine.
10. **Write it down.** ADRs for decisions, RFCs for designs, changelogs for history.
    If it isn't written down, it didn't happen.

---

_Next step upon approval: Phase 0 continues with the formal requirements
specification and module-boundary design for the identity core (tenancy, auth) —
still before any further implementation._
