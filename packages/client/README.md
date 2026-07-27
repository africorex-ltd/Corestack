# @corestack/client — placeholder

> **Status: 📋 Planned** — Epic [E16](../../docs/engineering/05-interface.md), Milestone M4.
> Purpose README only; code arrives when the epic starts.

The generated typed HTTP client for browsers and external consumers —
generated from the merged OpenAPI spec so it can never lag the API. Encodes
the contracts humans forget: typed error unions, retry-on-idempotent-only
with rate-limit pacing, automatic idempotency keys on money mutations,
cursor iterators, step-up interception, CSRF handling. Server-side TypeScript
adopters skip it entirely (use cases in-process).

Design: [Architecture §28](../../docs/architecture/ARCHITECTURE.md) ·
[API §24](../../docs/architecture/API.md)
