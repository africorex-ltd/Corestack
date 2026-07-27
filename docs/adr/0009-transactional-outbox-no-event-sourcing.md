# ADR 0009: Transactional outbox for events; no event sourcing

- **Status:** Accepted
- **Date:** 2026-07-28
- **Elaborated in:** [Architecture §13](../architecture/ARCHITECTURE.md), [Database §3](../architecture/DATABASE.md)

## Context

Cross-module behavior (audit, webhooks, notifications) rides on domain
events. Publish-after-commit without persistence silently drops events on
crash — fatal for audit and billing integrity.

## Decision

Every use case writes its events to `platform.outbox` **in the same
transaction** as its state change; an in-process relay dispatches after
commit with at-least-once semantics and per-consumer checkpoints; consumers
are idempotent (event-id dedupe helper). State is stored as current state —
events are published facts, **not** the persistence model.

## Alternatives considered

- **Direct publish after commit:** loses events on crash; rejected.
- **Message broker in core (Kafka/NATS):** infrastructure tax on every
  adopter; the relay is behind a port, so a broker-backed relay is a clean
  adapter for those who outgrow polling.
- **Event sourcing:** rebuild/versioning costs unjustified for SaaS
  control-plane data; the audit module provides append-only history where
  it's actually needed.

## Consequences

No lost events across crashes (verified by the crash-consistency suite);
consumers must handle redelivery; the outbox is the integration seam for
webhooks, audit, and future service extraction.
