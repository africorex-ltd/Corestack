# @corestack/webhooks — placeholder

> **Status: 📋 Planned** — Epic [E12](../../docs/engineering/04-revenue-delivery.md), Milestone M3.
> Purpose README only; code arrives when the epic starts.

Signed outbound delivery of platform events: org-registered endpoints
(https-only, SSRF-filtered), HMAC signatures with timestamp windows and
dual-secret rotation, retries with backoff and auto-disable, and a
per-attempt delivery log — the debugging surface adopters actually need.

Design: [Architecture §6](../../docs/architecture/ARCHITECTURE.md) ·
[Database §11](../../docs/architecture/DATABASE.md) ·
[API §16](../../docs/architecture/API.md)
