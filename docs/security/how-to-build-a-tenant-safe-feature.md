# How to Build a Tenant-Safe Feature

This is the mandatory contributor path for any feature that touches
tenant-owned data in CoreStack. It exists because the
[Tenant Isolation Certification](tenant-isolation-certification.md) found
that every isolation mechanism this codebase ships is real and tested —
but none of them are automatically wired together for you. Skipping a
step here reproduces exactly the residual risks that certification
ranked (R1–R4): a request that never resolves context correctly, a
repository that queries platform-wide by accident, an event consumer that
ignores the organization id it was handed.

Follow all ten steps for any use case, repository, or event consumer that
reads or writes tenant-owned data. If you're building something
deliberately platform-wide (not tenant-scoped), see the note on
`GlobalRepository` under step 4.

## The checklist

### 1. Resolve context

Never trust a client-claimed `organizationId` directly. Call
`resolveContext` (`packages/platform/src/application/resolve-context.ts`)
with the authenticated `Actor` and the claimed org id — it verifies real
membership via your `MembershipLookup` port and returns a `Context` whose
`organizationId` is server-verified, never client-asserted.

```ts
import { resolveContext } from "@corestack/platform";

const result = await resolveContext({ actor, claimedOrganizationId }, membershipLookup, ids);
if (!isOk(result)) return handleForbidden(result.error);
const context = result.value;
```

A forged org claim and a claim for a nonexistent org must produce the
identical error — never let your own binding code special-case one
differently, or you reopen the enumeration side-channel this resolver
exists to close.

### 2. Open a `UnitOfWork`

Every state-changing use case runs inside one `PostgresUnitOfWork.run()`
call — this is the transaction boundary, and it's what makes your
database writes and any events you publish atomic with each other.

```ts
import { PostgresUnitOfWork } from "@corestack/platform/postgres";

const uow = new PostgresUnitOfWork(sql, context.organizationId);
const result = await uow.run(async (ctx) => {
  // step 3, 4, 5 all happen here, using ctx.sql
});
```

Never open your own separate `sql.begin()` inside a use case that also
uses a `UnitOfWork` — that's the nested-transaction case the certification's
regression matrix proves fails loudly (`TransactionSql` has no `.begin()`).
And never grab a different connection from the pool inside `run()`'s
callback — `ctx.sql` **is** the correct, org-scoped connection for this
transaction; using anything else escapes both the transaction boundary
and (if `organizationId` was set) the RLS context.

### 3. Set org context (only if you're not already inside a `UnitOfWork`)

If your code path genuinely isn't inside a `UnitOfWork` — a read-only
query outside any transaction, for instance — use `withOrgContext`
directly instead of a bare `SET`:

```ts
import { withOrgContext } from "@corestack/platform/postgres";

const rows = await withOrgContext(sql, context.organizationId, async (tx) => {
  return tx`SELECT ...`;
});
```

**Never issue a bare `SET app.current_org = ...`.** The certification's
regression matrix (§4.6) proves directly why: a bare `SET` is
session-scoped and leaks into whatever the pooled connection does _next_,
after your transaction ends — a real connection-pool-poisoning risk.
`withOrgContext` and `PostgresUnitOfWork` both use `set_config(..., true)`
specifically because it's transaction-scoped and reverts automatically.

### 4. Use an org-scoped repository

Your repository methods take an `OrgScopedContext`, not a bare `Context`
and not a raw `organizationId` string:

```ts
import { requireOrgScoped, runOrgScopedQuery, type OrgScopedContext } from "@corestack/platform";

export class WidgetRepository {
  async list(context: OrgScopedContext) {
    return runOrgScopedQuery(this.#sql, context, async (tx) => {
      return tx<Widget[]>`SELECT * FROM widgets ORDER BY created_at`;
    });
  }
}
```

`requireOrgScoped(context)` narrows a plain `Context` (whose
`organizationId` might be `null`) to `OrgScopedContext` (guaranteed
non-null) — call it once, as close to your use case's entry point as
possible, and thread the narrowed type through. A bare `Context` passed
to `runOrgScopedQuery` is a **compile error**, not a runtime check you
could forget to add.

**If your repository is deliberately platform-wide** (cross-tenant
reporting, an admin tool) — a genuinely rare case — implement
`GlobalRepository` (`@corestack/platform`) instead, and cite the ADR that
approved the cross-tenant access in the same file:

```ts
// ADR-00xx: platform-wide admin reporting, cross-tenant by design.
import type { GlobalRepository } from "@corestack/platform";

export class AdminReportRepository implements GlobalRepository {
  readonly __globalRepository = true as const;
  // ...
}
```

The architecture-fitness suite (ADR-0021) enforces this at CI: any
`*repository*.ts` file that references neither `OrgScopedContext` nor
`GlobalRepository` fails the build, and `GlobalRepository` without an ADR
citation fails too.

### 5. Publish events through `ctx.publish`, never a bare `EventBus.publish`

Inside your `UnitOfWork.run()` callback, publish domain events via
`ctx.publish(event)` — this stages them into the transactional outbox
atomically with your other writes (T11), so "did the write happen" and
"will the event eventually be delivered" can never disagree. Never call
an `EventBus.publish` directly from inside a use case; that bypasses the
outbox entirely and can silently drop events on a crash.

Make sure your event's `organizationId` (the envelope field, not
something buried in the payload) is set correctly — it's what every
downstream consumer (step 6) and the purge protocol depend on.

### 6. Register your event consumer with `idempotentHandler`, and extract `organizationId` from the envelope

If your feature consumes events (not just publishes them), wrap your
handler with the kernel's `idempotentHandler` so redelivery is a no-op,
and extract `organizationId` from the event envelope explicitly before
doing anything tenant-scoped:

```ts
const subscription: EventSubscription = {
  consumer: "my-module:my-consumer", // explicit, unique — never omit this
  event: "some.thing.happened",
  handler: idempotentHandler("my-module:my-consumer", processedEventStore, async (event) => {
    if (event.organizationId === null) {
      throw new ValidationError("this event requires an organizationId");
    }
    // now use event.organizationId the same way a request handler would —
    // through withOrgContext / runOrgScopedQuery, never a raw connection.
  }),
};
```

This is exactly the pattern `registerPurgeHandler` already demonstrates —
follow it, don't reinvent it. The certification found (Residual Risk R4)
that nothing architecturally forces a consumer to do this; it's a
convention you're responsible for, every time.

### 7. Add an RLS migration for any new tenant-owned table

Every table storing tenant-owned rows needs `buildTenantIsolationDdl`
applied in its migration, targeting your app/platform roles:

```sql
-- generated via buildTenantIsolationDdl({ schema, table, appRole, platformRole })
ALTER TABLE my_schema.my_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE my_schema.my_table FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON my_schema.my_table
  TO my_app_role USING (organization_id = current_setting('app.current_org')::uuid);
CREATE POLICY platform_full_access ON my_schema.my_table
  TO my_platform_role USING (true);
```

This is your backstop — the layer that holds even if every step above is
bypassed or buggy. Don't skip it because "the application layer already
checks this."

### 8. Add integration tests proving isolation both directions

A test that only proves "wrong org gets nothing" can pass vacuously if
your role can't see the table at all. Prove **both** directions: org A
sees only org A's data, and org B sees only org B's data — mirroring
`tenant-policy.postgres.test.ts`'s pattern. Also add the negative case:
no org context set fails loudly (never silently returns rows or an
empty result you could confuse with "this tenant has no data").

### 9. Add architecture-fitness coverage if you're introducing a new pattern

If your feature introduces a new repository shape, a new SQL-access
pattern, or anything the existing rules (ADR-0021) wouldn't already
catch, extend `packages/architecture-tests/test/tenant-isolation.test.mjs`
— and prove your new rule against both a synthetic violating fixture and
a synthetic passing fixture before trusting it, exactly as that file's
existing rules are proven. A fitness rule nobody has watched fail is not
a tested rule.

### 10. Write a one-paragraph security review note in your PR

State explicitly: which repositories/tables this feature touches, whether
it's org-scoped or (rarely) a `GlobalRepository`, and which of the ten
steps above applied. This is not bureaucracy — it's the fastest way for a
reviewer to check the one thing that matters most (did tenant isolation
actually get threaded through), without re-deriving your whole feature's
data flow from the diff.

## What "good" looks like

The `examples/acme-crm-module` package
([README](../../examples/acme-crm-module/README.md)) is a complete,
minimal, real-Postgres-tested implementation of every step above,
end-to-end — built to the same rigor as shipped platform code, no
shortcuts. When in doubt about how a step should look in practice, read
that module before improvising.
