# @corestack/auth — placeholder

> **Status: 📋 Planned** — Epic [E06](../../docs/engineering/02-identity.md), Milestone M1.
> Purpose README only; code arrives when the epic starts.

Identity and authentication: user accounts, opaque server-side sessions
(revocation is a `DELETE`, not a cache prayer), credentials (argon2id), OAuth/
OIDC with PKCE, TOTP MFA with step-up, and org-scoped API keys. The most
security-critical module; ships with a threat model, ASVS L2 mapping, and an
adversarial test suite as release gates.

Design: [Architecture §16](../../docs/architecture/ARCHITECTURE.md) ·
[Database §4](../../docs/architecture/DATABASE.md) ·
[API §3–4](../../docs/architecture/API.md) ·
[Guide](../../docs/guides/AUTHENTICATION.md)
