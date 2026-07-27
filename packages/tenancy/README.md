# @corestack/tenancy — placeholder

> **Status: 📋 Planned** — Epic [E05](../../docs/engineering/02-identity.md), Milestone M1.
> Purpose README only; code arrives when the epic starts.

The platform's unit of tenancy: organizations, memberships, and invitations.
Every other module scopes tenant-owned data to this context's `Organization`
aggregate; billing bills it, rbac scopes to it, audit partitions by it.
Deliberately one fused context — splitting organizations from tenants is the
classic irreversible SaaS-starter mistake.

Design: [Architecture §6, §19–20](../../docs/architecture/ARCHITECTURE.md) ·
[Database §5](../../docs/architecture/DATABASE.md) ·
[API §5–6](../../docs/architecture/API.md)
