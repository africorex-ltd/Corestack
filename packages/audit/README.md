# @corestack/audit — placeholder

> **Status: 📋 Planned** — Epic [E08](../../docs/engineering/03-control-plane.md), Milestone M2.
> Purpose README only; code arrives when the epic starts.

The append-only compliance trail, fed exclusively by the transactional outbox
— complete by construction, not by discipline. Immutability is enforced in
the database (INSERT/SELECT-only grants, partition-drop retention); actor
labels are denormalized at ingest so the trail stays readable after GDPR
purges.

Design: [Architecture §6](../../docs/architecture/ARCHITECTURE.md) ·
[Database §8](../../docs/architecture/DATABASE.md) ·
[API §13–14](../../docs/architecture/API.md)
