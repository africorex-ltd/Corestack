# CoreStack

**The open-source foundation for production-ready SaaS applications.**

CoreStack is a modular TypeScript platform that gives you the parts every serious SaaS
needs — authentication, organizations & multi-tenancy, RBAC, billing, audit logging,
background jobs, and notifications — built on Clean Architecture so you can adopt the
whole platform or a single module, and swap any piece of infrastructure without
rewriting your domain logic.

> **Status: pre-alpha.** The architecture is being laid down module by module.
> Nothing here is API-stable yet. Follow along or get involved — early feedback
> shapes the platform.

## Why CoreStack

Every SaaS team rebuilds the same undifferentiated plumbing: auth flows, org/team
models, permission checks, Stripe webhooks, audit trails. Starter kits give you a
snapshot you fork and then own forever; BaaS products give you a black box you can't
extend. CoreStack takes a third path:

- **A platform, not a template.** Modules are versioned packages you upgrade, not
  scaffolded code you fork.
- **Your domain stays yours.** Business logic lives in framework-agnostic domain and
  application layers. Postgres, your HTTP framework, and your mail provider are
  adapters behind ports.
- **Security by default.** Every module ships with safe defaults: hashed tokens,
  tenant isolation, least-privilege RBAC, audit events.

## Architecture at a glance

CoreStack is a **modular monolith** organized by bounded context. Every module follows
the same layering, and dependencies only point inward:

```
interface (HTTP handlers, CLI)  →  application (use cases, ports)  →  domain (entities, rules)
                                        ↑
                     infrastructure (Postgres, email, Stripe adapters)
```

See [docs/architecture/overview.md](docs/architecture/overview.md) and the
[Architecture Decision Records](docs/adr/) for the full picture and the reasoning
behind every foundational choice.

## Packages

| Package                                | Description                                                      | Status         |
| -------------------------------------- | ---------------------------------------------------------------- | -------------- |
| [`@corestack/kernel`](packages/kernel) | Shared building blocks: `Result`, error taxonomy, clock/id ports | 🚧 In progress |
| `@corestack/auth`                      | Sessions, credentials, OAuth, MFA                                | Planned        |
| `@corestack/tenancy`                   | Organizations, memberships, invitations                          | Planned        |
| `@corestack/rbac`                      | Roles, permissions, policy checks                                | Planned        |
| `@corestack/billing`                   | Subscriptions, entitlements, provider adapters                   | Planned        |
| `@corestack/audit`                     | Append-only audit trail                                          | Planned        |

## Development

Requires Node.js ≥ 20.11 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm build      # build all packages
pnpm test       # run all tests
pnpm typecheck  # strict type checking across the workspace
```

## Roadmap & community

Where the project is headed: [ROADMAP.md](ROADMAP.md). Where to find help and
people: [COMMUNITY.md](COMMUNITY.md). Release digests: [CHANGELOG.md](CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and
[GOVERNANCE.md](GOVERNANCE.md) for how decisions are made. Architectural
changes start with an ADR — read the existing ones in [docs/adr/](docs/adr/)
first. The full documentation tree is mapped in
[docs/DOCUMENTATION-MAP.md](docs/DOCUMENTATION-MAP.md).

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
