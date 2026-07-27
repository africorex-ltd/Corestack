# @corestack/rbac — placeholder

> **Status: 📋 Planned** — Epic [E07](../../docs/engineering/03-control-plane.md), Milestone M2.
> Purpose README only; code arrives when the epic starts.

Deny-by-default, organization-scoped role-based access control: permission
catalog (code is truth), system + custom roles, assignments, and a policy
evaluator whose decisions carry rationale — "why was this allowed?" is
answerable by API. Adopter permissions register into the same catalog,
evaluator, and audit trail as platform ones.

Design: [Architecture §17–18](../../docs/architecture/ARCHITECTURE.md) ·
[Database §6](../../docs/architecture/DATABASE.md) ·
[API §7](../../docs/architecture/API.md) ·
[Guide](../../docs/guides/PERMISSIONS.md)
