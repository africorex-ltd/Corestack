# Component Spec — Tenant Isolation (RLS Harness)

- **Task:** E03-T30 · **Status:** Implemented · **Category:** DOM (policy template) + ADP (Postgres roles, RLS DDL, tx-scoped context setter)
- **ADR references:** ADR-0008 (pooled multi-tenancy, layer 3: "Postgres Row-Level Security as defense-in-depth"), ADR-0004 (Postgres behind ports), ADR-0010 (`./postgres` subpath)
- **Design docs:** [Architecture §20](../../docs/architecture/ARCHITECTURE.md) (the four-layer enforcement model), [Database §15](../../docs/architecture/DATABASE.md) (the exact column/policy/role shape this component implements)

## Contract

**Purpose:** give every future tenant-owned table a ready-made, tested RLS
backstop — the third of ADR-0008's four enforcement layers, sitting behind
(1) repository port signatures requiring an org id and (2) the
server-resolved `Context` (E03-T32, `resolveContext`). This component does
**not** implement layer 4 (the mandatory cross-tenant isolation test suite
that deliberately breaks a repository's own filtering to prove RLS catches
it) — that is **E04-T07**, which depends on this task.

**Public surface:**

| Export                    | Layer                        | Purpose                                                                                              |
| ------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `buildTenantIsolationDdl` | domain                       | Pure policy-template generator — four ordered DDL statements per tenant-owned table                  |
| `ensureTenancyRoles`      | infrastructure, `./postgres` | Idempotent bootstrap for the two ADR-0008 roles (application role, platform role)                    |
| `withOrgContext`          | infrastructure, `./postgres` | Transaction-scoped `app.current_org` setter every repository adapter must run tenant queries through |

## The policy template

`buildTenantIsolationDdl({ schema, table, appRole, platformRole })` emits,
in order:

1. `ALTER TABLE <schema>.<table> ENABLE ROW LEVEL SECURITY`
2. `ALTER TABLE <schema>.<table> FORCE ROW LEVEL SECURITY`
3. `CREATE POLICY tenant_isolation ... TO <appRole> USING (organization_id = current_setting('app.current_org')::uuid)`
4. `CREATE POLICY platform_full_access ... TO <platformRole> USING (true)`

Two roles, not one — DB §15 calls for "a separate policy role for
platform-scoped access (relay, sweepers, support tooling) that is _not_
the web application's role." The platform role gets its **own** permissive
policy rather than relying on `app.current_org` being unset to mean
"allow all" (see the finding below for why that fallback is not reliable).

`FORCE`, not just `ENABLE`, matters: without it, the table's _owner_
(whichever role ran `CREATE TABLE`) bypasses every policy, so a fixture
table created by the same admin connection that also owns the migration
tooling would silently defeat its own isolation test. Verified in
integration: a real Postgres superuser still bypasses RLS regardless of
`FORCE` (superusers are always exempt — that exemption is Postgres's, not
this component's), but a `FORCE`d table correctly restricts every
non-superuser role, including the table's non-superuser owner if one is
ever used.

## Finding: `current_setting`'s reset value is not consistently `NULL`

Empirically verified against PostgreSQL 18 (not a version-specific
finding — general Postgres GUC-scoping behavior, but non-obvious and
load-bearing for this design):

- On a connection that has **never** called `set_config('app.current_org', ...)`
  in the current session, `current_setting('app.current_org', true)`
  (the `missing_ok` form) returns `NULL`, and `current_setting('app.current_org')`
  (no `missing_ok`) throws `unrecognized configuration parameter`.
- On a connection that **has** called `set_config(..., true)` (transaction-scoped)
  in some earlier, now-committed transaction, the custom GUC placeholder
  now exists in the session — so a later transaction that forgot to set it
  again sees `current_setting(..., true)` return `''` (empty string, the
  reset value), not `NULL`. Casting that to `::uuid` throws `invalid input
syntax for type uuid`.

Both paths are hard failures, never a silent wrong-tenant read and never a
silently-empty "looks like no results" response. This is why
`buildTenantIsolationDdl`'s `tenant_isolation` policy deliberately omits
`missing_ok` — a forgotten `withOrgContext` call fails loudly and
identically-severely regardless of the connection's prior history, rather
than behaving differently the first time a pooled connection is reused
than every time after. It also rules out "rely on unset context" as a way
to give the platform role unrestricted access — the reset value is not a
stable, checkable "no org" sentinel, hence `platform_full_access` as an
explicit separate policy instead.

## `withOrgContext`

```ts
withOrgContext(sql, organizationId, async (tx) => {
  /* tenant-scoped queries against `tx` */
});
```

Sets `app.current_org` via `SELECT set_config('app.current_org', $1, true)`
— a normal parameterized query — inside a `sql.begin()` transaction, then
calls `fn(tx)`. Verified empirically that `SET LOCAL app.current_org = $1`
is **not** an option: `SET LOCAL` does not accept a bind parameter, and
postgres.js's tagged template rejects it with `syntax error at or near
"$1"` before the statement reaches Postgres at all. `set_config`'s third
argument (`is_local = true`) gives the same transaction-scoped-only
behavior through an ordinary parameterized call.

## Role bootstrap

`ensureTenancyRoles(sql, { appRole, platformRole })` idempotently creates
both roles `NOLOGIN` (`CREATE ROLE` has no `IF NOT EXISTS`, so existence is
checked against `pg_roles` first). Neither role has a real login
credential yet — nothing connects to Postgres directly as either role
today. A future connection-pooling task (E03-T40) decides how a real
deployment authenticates as the application role (a dedicated login role
per environment, or `SET ROLE` from an already-authenticated pool
connection); this bootstrap only creates the roles, it does not wire that
decision in.

## Testing

**Test harness for a role with no real login:** integration tests exercise
the app/platform roles via `SET LOCAL ROLE` (test-support's `withRole`),
verified empirically that a superuser can `SET LOCAL ROLE` into any
`NOLOGIN` role with no explicit membership grant, reverting cleanly on
commit — the same mechanism works identically in both of
`test-database.ts`'s modes (local Postgres, Testcontainers), since it
depends only on ordinary Postgres role semantics, not on which mode
created the connection.

**Known harness limitation:** `withRole` proves the policies apply once
`current_user` is switched via `SET ROLE` from a superuser session — it
does not prove behavior is identical for a connection _authenticated_
directly as the restricted role (no superuser session ever involved).
E03-T40 is expected to wire up real per-role credentials as the
production path; when it does, re-verify this harness's conclusions
against that path rather than assuming `SET ROLE` equivalence carries
over unexamined.

**8 pure unit tests** (`test/domain/tenant-policy.test.ts`): DDL statement
ordering, role/predicate scoping for both policies, identifier-validation
rejection for every unsafe input.

**7 real-Postgres integration tests**
(`test/integration/tenant-policy.postgres.test.ts`), proving the isolation
in **both directions** — a role that could not see the table at all would
pass a "wrong org sees nothing" check vacuously:

- app role scoped to org A sees org A's row, not org B's;
- app role scoped to org B sees org B's row, not org A's;
- app role with no org context set fails loudly (matches the finding
  above — either error message, since which one occurs depends on
  connection history, not a bug);
- platform role sees every row regardless of `app.current_org`;
- the owning superuser still bypasses RLS even with `FORCE` set
  (documents Postgres's own superuser exemption rather than asserting
  isolation for a role Postgres deliberately never restricts);
- `withOrgContext` sets the value for the transaction's duration and it
  reverts after commit;
- `withOrgContext` propagates the wrapped callback's return value.

## Design rationale

Why a pure domain-layer template function instead of executing DDL
directly from one infrastructure function, as `outbox-partition-ddl.ts`
does for partition creation? The RLS policy text has no per-call state
(unlike partition bounds, which are computed from a reference date) — it's
a straightforward string template validated against known-safe
identifiers, and keeping it framework-free means the exact SQL any future
module ships for its own tables is unit-testable without a live
connection, the same reasoning `outbox-partition.ts`'s pure bound
computation already established for the partition-maintenance component.

Why does the platform role get `USING (true)` rather than a policy that,
say, checks a claim on the connection? Simplicity matching the actual
threat model: the platform role is only ever reached via trusted,
first-party infrastructure code (relay, sweepers, support tooling) — the
same trust boundary DB §15 already draws around it — not external input.
Layer 3 (RLS) exists to catch layer-1/layer-2 _application_ bugs; it isn't
meant to re-derive trust for code that was never subject to layers 1/2 in
the first place.
