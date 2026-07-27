# ADR 0006: MIT license

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

CoreStack's goal is maximum adoption as the foundation layer of commercial SaaS
products. License friction is adoption friction: legal review of copyleft licenses
stalls or kills adoption inside companies.

## Decision

**MIT** for the entire repository and all published packages.

## Alternatives considered

- **AGPL (Cal.com model):** protects against closed-source competitors offering
  CoreStack-as-a-service, but scares away exactly the commercial adopters we want.
  CoreStack is a library platform, not a hosted product; the SaaS-protection
  rationale doesn't apply.
- **Apache-2.0 (Supabase model):** the patent grant is a real benefit, but MIT's
  simplicity and universal pre-approval in corporate policies wins for a
  dependency-style platform. Revisit if the project attracts patent-sensitive
  enterprise contributors.

## Consequences

- Anyone may use, modify, and sell CoreStack-based products with attribution.
- Contributions are accepted under MIT via the inbound=outbound norm; no CLA for now.
