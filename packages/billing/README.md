# @corestack/billing — placeholder

> **Status: 📋 Planned** — Epic [E09](../../docs/engineering/04-revenue-delivery.md), Milestone M3.
> Purpose README only; code arrives when the epic starts.

Billing as state reconciliation, not a checkout widget: code-defined versioned
plans (grandfathering by construction), a subscription state machine, and the
entitlements read model the whole app checks. Provider webhooks are hints;
the provider API is truth — every event triggers fetch-and-reconcile. Stripe
is the reference adapter behind a vendor-neutral `PaymentGateway` port.

Design: [Architecture §21](../../docs/architecture/ARCHITECTURE.md) ·
[Database §7](../../docs/architecture/DATABASE.md) ·
[API §8](../../docs/architecture/API.md)
