# ADR 0020: `IdempotencyStore.begin`/`complete` require `organizationId`

- **Status:** Accepted
- **Date:** 2026-07-29
- **Elaborated in:** [Architecture §20](../architecture/ARCHITECTURE.md) (pooled multi-tenancy, layered enforcement), [Architecture §26](../architecture/ARCHITECTURE.md) (request-level idempotency)
- **Supersedes/amends:** ADR-0019 (`IdempotencyStore` added to the kernel) — the port shape ADR-0019 introduced is corrected here, not reversed; ADR-0019's core decision (the port belongs in the kernel) stands

## Context

A Tenant Isolation Certification review (commissioned after T30/T31/T33
shipped RLS, org-scoped repositories, and the purge protocol) audited every
tenant-isolation-relevant component as one system, including the
`IdempotencyStore` port added in E03-T43 (ADR-0019).

The as-shipped port keyed purely on `(scope, key)`:

```ts
begin(scope: string, key: string, requestHash: string, ttlMs: number): Promise<IdempotencyBeginResult>;
```

`key` is the client-supplied `Idempotency-Key` header value; `scope` is an
application-chosen "endpoint class" string (e.g. `"orders:create"`) with
no structural connection to the caller's organization. Nothing in the
port, the in-memory reference, or the Postgres adapter prevented two
different organizations from presenting an identical `(scope, key)` pair —
which a real caller can trivially do, since `key` originates from the
client, not the server. Confirmed directly with both implementations
(`InMemoryIdempotencyStore` and `PostgresIdempotencyStore`): Organization
B calling `begin()` with the same `(scope, key, requestHash)` Organization
A had already completed received `{ outcome: "replay", response:
<Organization A's stored response> }` — a genuine cross-tenant
data-disclosure path, verified as a failing regression test against the
as-shipped code before this fix, not a theoretical concern.

No real caller exists yet for this port (no REST binding/E14 work has
started), so this was caught before it could be exploited in practice —
but it shipped as a public kernel export, and the risk was real the moment
any interface binding used it without independently reinventing an
org-qualification convention nothing enforced.

## Decision

`organizationId: string | null` becomes a mandatory, leading parameter on
both `IdempotencyStore.begin` and `.complete`:

```ts
begin(organizationId: string | null, scope: string, key: string, requestHash: string, ttlMs: number): Promise<IdempotencyBeginResult>;
complete(organizationId: string | null, scope: string, key: string, requestHash: string, response: unknown, ttlMs: number): Promise<void>;
```

`null` is reserved for genuinely platform-scoped (not tenant-owned)
operations, mirroring `PostgresUnitOfWork`'s existing
`organizationId: string | null` constructor parameter — the same
"explicit null for platform, a real id for a tenant" convention already
established in this codebase.

**Enforcement is structural, not conventional.** Both implementations
compose `organizationId` into their internal keying scheme themselves,
inside the store:

- `InMemoryIdempotencyStore` folds it into its `Map` key.
- `PostgresIdempotencyStore` composes the physical `scope` column value as
  `JSON.stringify([organizationId, scope])` before any SQL touches
  `platform.idempotency_keys` — chosen over a NUL-byte-separated string
  after empirical verification showed Postgres `text` columns reject the
  NUL byte outright (`invalid byte sequence for encoding "UTF8": 0x00`).
  JSON encoding has no separator-collision question to answer.

A caller cannot bypass this by mis-naming their own `scope` string,
because they never see or construct the physical storage key — they only
ever supply their own logical `scope` and their own `organizationId` as
independent parameters. This is why the fix lives in the port signature
and both implementations, not in a helper function callers might forget
to use.

**No `platform.idempotency_keys` schema change.** The DB §3 schema (`key`,
`scope`, `request_hash`, `response_snapshot`, `status`, `expires_at`, PK
`(scope, key)`) is unchanged — the composed value is stored in the
existing `scope text` column, an internal adapter detail invisible outside
`PostgresIdempotencyStore`. This avoids a schema migration for what is
fundamentally a port-contract fix, not a storage-shape change.

## Alternatives considered

- **Document the org-qualification requirement as a caller convention**
  (e.g. "always prefix your `scope` with the organization id"), with a
  helper function to make it easy: rejected — a convention a caller can
  forget is exactly the gap that produced this finding in the first place.
  The whole point of structural enforcement is that forgetting isn't
  possible.
- **Add an `organization_id` column to `platform.idempotency_keys` and
  make it part of the primary key**: rejected for now — Postgres
  `PRIMARY KEY` columns are implicitly `NOT NULL`, so a nullable
  `organizationId` (required for platform-scoped operations) would need
  its own sentinel value in the schema, which is the same problem moved
  into the database rather than solved. The in-adapter composition
  achieves the identical isolation guarantee without a schema change or
  migration. If a future need arises for `organization_id` to be
  independently queryable/indexable (e.g. for an admin tool listing a
  tenant's idempotency keys), that's a new, separate ADR at that time.

## Consequences

- Breaking change to `IdempotencyStore`, `InMemoryIdempotencyStore`, and
  `PostgresIdempotencyStore` — every call site updates. No real external
  caller exists yet (pre-1.0, no REST binding built), so the practical
  blast radius is this repository's own tests, all updated in the same
  change.
- New regression tests (kernel unit + Postgres integration) prove the
  cross-tenant scenario directly: two organizations presenting an
  identical `(scope, key, requestHash)` get independent `started`
  outcomes, never a shared lock or a cross-tenant `replay`. Each test was
  verified to fail against the pre-fix (org-blind) implementation before
  being finalized.
- `docs/idempotency-key-store.md` (component spec) and the kernel port's
  own TSDoc are updated to describe the corrected contract; no separate
  migration or backfill is needed since no production data exists under
  the old scheme.
