# ADR 0007: Opaque server-side sessions, not stateless JWTs

- **Status:** Accepted
- **Date:** 2026-07-28
- **Elaborated in:** [Architecture §16](../architecture/ARCHITECTURE.md), [Database §4](../architecture/DATABASE.md)

## Context

Session revocation must be immediate: "admin suspends a user and it takes
effect now" is a hard enterprise requirement (Vision persona: Daniel).
Stateless JWTs make revocation a cache-invalidation problem; opaque sessions
make it a `DELETE`.

## Decision

Primary sessions are opaque 256-bit random tokens, stored SHA-256-hashed in
Postgres, delivered as `HttpOnly; Secure; SameSite=Lax` cookies (bearer header
for non-browser clients). Sliding + absolute expiry; device listing and remote
revocation are first-class use cases. Lookup cost is mitigated by
version-stamped caching with security-critical revocations bypassing cache
(Architecture §12).

## Alternatives considered

- **Stateless JWT sessions:** rejected — revocation latency is a security
  property we refuse to trade for a DB round-trip.
- **Hybrid short-JWT + refresh:** deferred; appropriate later for
  service-to-service, layerable without changing this model.

## Consequences

Every session validation touches Postgres (or the bounded-lag cache); in
exchange, suspension/logout/compromise response are immediate and auditable.
