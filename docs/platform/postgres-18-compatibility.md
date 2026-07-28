# PostgreSQL 18 Compatibility Verification

- **Status:** Verified empirically against a real local PostgreSQL 18.4 instance (Windows), 2026-07-28
- **Why:** local development moved from Testcontainers-only (`postgres:16-alpine`) to a dual-mode bootstrap that can also target a locally installed PostgreSQL 18 instance. Every assumption the outbox epic's code and docs bake in about Postgres behavior was re-verified empirically against 18.4 before trusting it, per this project's standing "verify, don't assume" practice.
- **Related:** [outbox-architecture.md](outbox-architecture.md), [outbox-schema.md](../../packages/platform/docs/outbox-schema.md), [outbox-partition-maintenance.md](../../packages/platform/docs/outbox-partition-maintenance.md)

## Method

Six throwaway checks were run directly against the local PostgreSQL 18.4
instance via the `postgres` npm driver (the same driver the platform
package uses in production), each creating and dropping its own scratch
schema/database, never touching `platform.*` or any committed migration.
No temporary script was committed; this document is the durable record.

## Finding: the partition-bound timezone bug reproduces identically on PG18 — the existing fix remains load-bearing

This is the headline result, not a footnote. `computeMonthlyPartitionBounds`
(E03-T10, fixed under `ba0c8bc`) exists specifically because a bare
`YYYY-MM-DD` partition-bound literal is parsed using the DDL session's
`TimeZone`, not UTC. Reproduced directly on PG18:

```sql
SET TimeZone = 'America/New_York';
CREATE TABLE outbox_bare_2026_08 PARTITION OF outbox_bare
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
```

Inspecting the stored bound afterward:

```
FOR VALUES FROM ('2026-08-01 00:00:00-04') TO ('2026-09-01 00:00:00-04')
```

— confirmed the bound is anchored to `America/New_York` midnight, not UTC
midnight, on PostgreSQL 18.4 exactly as it was on 16. A subsequent insert
of the UTC instant `2026-08-01T00:00:00+00:00` (four hours _before_ the
stored `-04` bound) correctly fails with `no partition of relation
"outbox_bare" found for row` — proving the gap is real, not
version-specific, and that `computeMonthlyPartitionBounds`'s explicit
`+00:00`-offset literals remain **necessary**, not vestigial, on the new
target version. No code change required; the existing fix already covers
PG18 identically.

## Other checks: no behavioral differences found

| Area                                                         | What was checked                                                                                                                                                                | Result                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Row-value tuple comparison                                   | `WHERE (occurred_at, id) > ($1::timestamptz, $2::uuid)` against two rows sharing a timestamp                                                                                    | Identical to documented PG16 behavior — returns exactly the row sorting after the given `id` at the shared timestamp, never both or neither                                                                                                                                   |
| Privilege enforcement                                        | `REVOKE UPDATE, DELETE` from a role, then attempt INSERT (succeeds)/UPDATE (denied)/DELETE (denied) as that role                                                                | Identical — `permission denied for table` on both UPDATE and DELETE, INSERT unaffected                                                                                                                                                                                        |
| Transactional semantics                                      | `sql.begin()` wrapping two inserts across two tables, forced rollback via a thrown error                                                                                        | Identical — both tables show zero rows after rollback, matching the outbox's dual-write atomicity guarantee                                                                                                                                                                   |
| RLS policy enforcement                                       | A basic `USING (org_id = current_setting('app.current_org', true))` policy, queried as a restricted role under different session settings, including the setting entirely unset | Identical — correct per-org filtering, and an unset session variable correctly yields zero rows (`current_setting(..., true)` returns `NULL`, and `org_id = NULL` is never true) rather than leaking all rows. Relevant groundwork for the not-yet-built E03-T30 RLS harness. |
| Advisory locks (`pg_try_advisory_lock`/`pg_advisory_unlock`) | Used by the migration runner (T02) for cross-process serialization                                                                                                              | Identical — lock acquired and released successfully                                                                                                                                                                                                                           |
| `pg_inherits`/`pg_class` partition enumeration               | The exact query `maintainOutboxPartitions` (T03) uses to list `platform.outbox`'s child partitions                                                                              | Identical — returns the expected partition name                                                                                                                                                                                                                               |
| `CREATE INDEX CONCURRENTLY` outside a transaction            | Used by the migration runner (T02)                                                                                                                                              | Identical — succeeds outside an explicit transaction block, as required                                                                                                                                                                                                       |
| `DROP DATABASE ... WITH (FORCE)`                             | Needed by the new local-mode test-database bootstrap (see below) to reclaim a scratch database even with a lingering connection                                                 | Succeeds and terminates the live connection automatically — available and working on PG18 (requires PG13+)                                                                                                                                                                    |
| `ON CONFLICT (...) DO NOTHING`                               | The `processed_events` dedupe pattern (T14)                                                                                                                                     | Identical — a duplicate insert is silently absorbed, exactly one row remains                                                                                                                                                                                                  |

## Explicitly not a finding: jsonb key reordering

A round-tripped `jsonb` payload came back with its top-level keys in a
different order than the object literal that was inserted
(`{"nested":...,"arr":...}` in, `{"arr":...,"nested":...}` out). This is
**not a PostgreSQL 16→18 compatibility difference** — it is `jsonb`'s
documented, version-independent behavior: unlike the `json` type (which
preserves the original input text verbatim), `jsonb` stores a decomposed
binary representation and does not guarantee key order on output. This
has zero effect on the outbox writer's correctness: nothing in this
codebase compares a round-tripped payload by serialized string or key
order — deep-equality checks (`toEqual` in Vitest, property access in
application code) are order-independent. Recorded here explicitly so a
future reader doesn't re-investigate it as a regression.

## Conclusion

No PostgreSQL 16 → 18 behavioral difference was found in anything the
outbox epic's code or tests depend on. The one real risk area (partition
bound parsing) was already covered by an existing, tested fix, and that
fix's necessity was reconfirmed directly against 18.4 rather than assumed
to still apply. Local development can proceed against PostgreSQL 18 with
no code changes to the shipped outbox subsystem.
