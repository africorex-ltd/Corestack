# @corestack/storage — placeholder

> **Status: 📋 Planned** — Epic [E13](../../docs/engineering/04-revenue-delivery.md), Milestone M3.
> Purpose README only; code arrives when the epic starts.

The `FileStorage` port and object metadata registry: signed-URL upload
handshake (bytes never transit the app), derived object keys (path traversal
impossible by construction), content-type allowlisting before signing, and
soft-delete→purge lifecycle where metadata always outlives bytes. S3-compatible
reference adapter covers AWS/R2/MinIO in one.

Design: [Architecture §22](../../docs/architecture/ARCHITECTURE.md) ·
[Database §12](../../docs/architecture/DATABASE.md) ·
[API §10](../../docs/architecture/API.md)
