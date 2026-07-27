# CoreStack Roadmap

> **Phases gate on quality, not dates.** Dates below are planning targets;
> revisions happen openly in the [devlog](COMMUNITY.md), never silently.
> Source of truth for the work itself: the
> [engineering blueprint](docs/engineering/00-OVERVIEW.md).

**Current phase: M0 — Foundation** (design complete; implementation starting).

## Milestones

| Milestone                 | Target | What ships                                                                                                                                   | Status                                                   |
| ------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **M0 Foundation**         | +2 mo  | CI/security/release pipeline, `@corestack/kernel` 0.1, outbox + migration engine + composition root, contract-test kit                       | 🔨 In progress — design docs approved; kernel scaffolded |
| **M1 Identity preview**   | +6 mo  | `@corestack/tenancy` + `@corestack/auth` 0.x on npm; quickstart proving register→org→invite in < 1 h; cross-tenant isolation suite gating CI | 📋 Planned                                               |
| **M2 Control plane**      | +9 mo  | `@corestack/rbac` (decision rationale API) + `@corestack/audit` (outbox-fed, append-only)                                                    | 📋 Planned                                               |
| **M3 Revenue & delivery** | +13 mo | `billing` (Stripe reference), `webhooks`, `notifications`, `jobs`, `storage`                                                                 | 📋 Planned                                               |
| **M4 Surface complete**   | +16 mo | Full REST surface + OpenAPI artifact, `@corestack/client` SDK, CLI, deployed reference app, docs site                                        | 📋 Planned                                               |
| **M5 1.0 hardened**       | +20 mo | External security audit, published load numbers, API freeze, **1.0** for kernel/tenancy/auth/rbac/audit, public launch                       | 📋 Planned                                               |

## Deliberately deferred (with reasons, not silence)

| Item                        | Why deferred                                                                   | Where the reasoning lives                             |
| --------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| GraphQL API                 | REST + typed SDK covers the need; community binding possible                   | [Architecture §27](docs/architecture/ARCHITECTURE.md) |
| Sub-org teams / hierarchies | Multiplies every module's complexity; needs a real enterprise driver           | Architecture §19, API §6                              |
| Search module               | No in-core consumer yet; Postgres FTS covers audit                             | Architecture §23                                      |
| Feature-flag engine         | Entitlements cover product-tier gating; experimentation is a different product | Architecture §33                                      |
| AI module                   | Requires a vision-amendment ADR; schema reserved                               | [Database §14](docs/architecture/DATABASE.md)         |
| WebAuthn/passkeys           | Fast-follow after TOTP unblocks enterprise checklists                          | Architecture §16                                      |
| Python/Go SDKs              | Generated from OpenAPI post-1.0; TypeScript first                              | Architecture §28                                      |
| Usage-based billing         | Port anticipated; post-1.0                                                     | Architecture §21                                      |

## How to influence this roadmap

Scoped improvements → [feature request](.github/ISSUE_TEMPLATE/feature_request.yml).
Substantial ideas (new modules, ports, API changes) → the RFC track
([GOVERNANCE.md](GOVERNANCE.md)). The out-of-scope list in the
[vision](docs/product/VISION.md) is enforced in triage — proposals that engage
with the written reasoning get engagement back.
