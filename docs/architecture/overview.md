# CoreStack Architecture — 5-Minute Overview

> Thin, dated summary (2026-07-28). **The normative source is
> [ARCHITECTURE.md](ARCHITECTURE.md)** — 48 sections, every decision with its
> reasoning — plus [DATABASE.md](DATABASE.md), [API.md](API.md), and the
> [ADRs](../adr/README.md). If this page and those disagree, they win (and
> file a docs bug).

CoreStack is a **modular monolith delivered as a library platform**: versioned
`@corestack/*` packages composed inside _your_ application process, over _your_
PostgreSQL. There is no CoreStack server or control plane to operate — that is
the structural form of the no-lock-in promise.

**The five load-bearing ideas:**

1. **Clean Architecture per module** — `domain → application → infrastructure/
interface`, dependencies point inward, vendors exist only behind ports.
   Machine-enforced by lint zones and the architecture fitness suite.
2. **Events over imports** — modules never import each other; they consume
   published, versioned domain events through a **transactional outbox**
   (ADR-0009), which is what makes audit/webhooks/notifications
   complete-by-construction and any-subset composition work.
3. **Pooled multi-tenancy, enforced four times** (ADR-0008) — org-id-required
   port signatures, server-resolved context, Postgres RLS backstop, and an
   unskippable cross-tenant isolation suite in CI.
4. **Opaque server-side sessions** (ADR-0007) — revocation is a `DELETE`,
   not a cache-expiry prayer.
5. **Node + Postgres is enough** — queue, rate limiting, and eventing default
   to Postgres-backed adapters; Redis and friends are opt-in swaps behind
   contract-tested ports.

**Current state:** kernel contract surface complete (Result, errors, Context,
events, and the EventBus/Logger/Cache/RateLimiter/Encrypter/UnitOfWork ports
with reference implementations); modules land per the
[engineering blueprint](../engineering/00-OVERVIEW.md) — tenancy and auth
first (M1). Quality is governed continuously: see
[docs/quality/dashboard.md](../quality/dashboard.md).
