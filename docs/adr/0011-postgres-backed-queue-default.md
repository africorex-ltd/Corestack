# ADR 0011: Postgres-backed job queue as the reference default

- **Status:** Accepted
- **Date:** 2026-07-28
- **Elaborated in:** [Architecture §14](../architecture/ARCHITECTURE.md), [Database §10](../architecture/DATABASE.md)

## Context

Background jobs need a queue; requiring Redis or a broker on day one breaks
the "Node + Postgres is enough" promise and complicates transactional
enqueue.

## Decision

The reference `JobQueue` adapter is Postgres-backed (`FOR UPDATE SKIP LOCKED`
worker polling), giving transactionally consistent enqueue — a job enqueued
in a use case commits or rolls back with it. A BullMQ/Redis adapter is the
sanctioned second implementation for adopters needing higher throughput;
behavioral equivalence is guaranteed by the shared port contract-test suite.

## Alternatives considered

- **Redis-first (BullMQ) as default:** extra required infrastructure and
  no transactional enqueue; rejected as default, kept as scale-up adapter.

## Consequences

Zero-infrastructure default; the hot jobs table needs sweeping to history
partitions (designed in); throughput ceiling (~1k jobs/sec) documented with
the Redis escape hatch.
