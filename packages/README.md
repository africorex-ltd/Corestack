# packages/

Publishable `@corestack/*` packages. **Placeholder folders carry a purpose
README only — no `package.json`** — so they are visible in the tree but inert
to the workspace until their blueprint epic starts (founder decision
2026-07-28, amending structure doc §1; workspace membership begins with the
epic).

| Package                                    | Bounded context / purpose                                        | Status         | Epic · Milestone    |
| ------------------------------------------ | ---------------------------------------------------------------- | -------------- | ------------------- |
| [`kernel`](kernel)                         | Shared contracts (Result, errors, ports) — **Release Candidate** | 🚧 In progress | E02 · M0            |
| [`platform`](platform)                     | Migrations, outbox, composition root, tenant isolation           | 🚧 In progress | E03 · M0            |
| [`architecture-tests`](architecture-tests) | Architecture fitness suite (private, never published)            | 🚧 Active      | governance §7.1–7.2 |
| [`tenancy`](tenancy)                       | Organizations, memberships, invitations                          | 📋 Planned     | E05 · M1            |
| [`auth`](auth)                             | Accounts, sessions, OAuth, MFA, API keys                         | 📋 Planned     | E06 · M1            |
| [`rbac`](rbac)                             | Roles, permissions, policy decisions                             | 📋 Planned     | E07 · M2            |
| [`audit`](audit)                           | Append-only compliance trail                                     | 📋 Planned     | E08 · M2            |
| [`billing`](billing)                       | Plans, subscriptions, entitlements                               | 📋 Planned     | E09 · M3            |
| [`notifications`](notifications)           | Templated multi-channel delivery                                 | 📋 Planned     | E10 · M3            |
| [`jobs`](jobs)                             | Background work & scheduling                                     | 📋 Planned     | E11 · M3            |
| [`webhooks`](webhooks)                     | Signed outbound event delivery                                   | 📋 Planned     | E12 · M3            |
| [`storage`](storage)                       | FileStorage port + object registry                               | 📋 Planned     | E13 · M3            |
| [`cli`](cli)                               | `corestack` operator CLI                                         | 📋 Planned     | E15 · M4            |
| [`client`](client)                         | Generated typed HTTP client SDK                                  | 📋 Planned     | E16 · M4            |

Naming is fixed by the architecture's ubiquitous language — notably `tenancy`
(one fused context, not organizations+tenants) and `rbac` (not permissions);
see [Architecture §5–6](../docs/architecture/ARCHITECTURE.md). Deliberately
absent: `ui` (headless platform, Vision §9), `plugins` (modules _are_ the
plugin system, Architecture §24), `database` (per-module adapters, ADR-0004),
`ai` (deferred pending vision-amendment ADR, Database §14).
