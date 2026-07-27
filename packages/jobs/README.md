# @corestack/jobs — placeholder

> **Status: 📋 Planned** — Epic [E11](../../docs/engineering/04-revenue-delivery.md), Milestone M3 (leads M3 — other modules consume it).
> Purpose README only; code arrives when the epic starts.

Queue-agnostic background work: transactional enqueue (a job enqueued in a
use case commits or rolls back with it), typed payloads, retries with
backoff + dead-letter, cron schedules, and a worker runtime with graceful
drain. Postgres `SKIP LOCKED` reference adapter (zero extra infrastructure);
BullMQ/Redis adapter for higher throughput.

Design: [Architecture §14](../../docs/architecture/ARCHITECTURE.md) ·
[Database §10](../../docs/architecture/DATABASE.md)
