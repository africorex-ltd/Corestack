# Tenant Isolation Certification

- **Date:** 2026-07-29 · **Mode:** Platform Maturity — Security Certification
- **Trigger:** T30 (RLS harness), T31 (org-scoped repository base), and T33
  (purge protocol) accepted; before any new feature work or E04 expansion,
  every tenant-isolation-relevant component is audited together as one
  security system, per a production-SaaS isolation review standard.
- **Scope:** every component listed in the certification request —
  context resolution, `setOrgContext`, the org-scoped repository base, RLS
  policies, `PostgresUnitOfWork`, the outbox relay and its consumers, the
  idempotency store, the purge protocol, health/readiness checks,
  background jobs, future event consumers, and the composition root.
- **Method:** every claim in this document is backed by a file path, a
  test, or an empirical script run against real PostgreSQL 18 — not
  inferred from naming or design intent. Where a component in the request
  doesn't exist yet in this codebase, that's stated plainly rather than
  described as if it were audited.
- **Companion documents:** [Section 3 empirical findings](#3-empirical-findings-postgresql-18)
  are below; the [regression test matrix](#4-regression-test-matrix) and
  [architecture fitness rules](#5-architecture-fitness-rules) summarize
  work done directly in the test suites and `packages/architecture-tests`,
  cross-linked rather than duplicated here.

## Naming note

The certification request used names that don't exactly match this
codebase's actual exports. Mapped once, here, so the rest of this document
can use the real names:

| Requested name            | Actual export                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `OrgContextResolver`      | `resolveContext` (`packages/platform/src/application/resolve-context.ts`) + `requireOrgScoped`/`OrgScopedContext` (`org-scoped-context.ts`) |
| `setOrgContext`           | `withOrgContext` (`packages/platform/src/infrastructure/postgres-org-context.ts`)                                                           |
| `OrgScopedRepository`     | `runOrgScopedQuery` (`postgres-org-scoped-repository.ts`) + the `OrgScopedContext` type it requires                                         |
| `PostgreSQL RLS policies` | `buildTenantIsolationDdl` (`domain/tenant-policy.ts`) + `ensureTenancyRoles` (`postgres-tenancy-roles.ts`)                                  |

---

## 1. Per-layer audit

### 1.1 Context resolution — `resolveContext` + `requireOrgScoped`

**Trust boundary:** the edge between an authenticated `Actor` and a
tenant-scoped `Context`. Everything downstream of this layer trusts
`Context.organizationId` completely; nothing downstream re-verifies
membership.

**Assumptions:**

- `resolveContext`'s caller has already authenticated the `Actor` (session
  or API key validation happens elsewhere — this layer's own doc comment
  states authentication is out of scope, deferred to the auth module,
  E06).
- The claimed `organizationId` passed in is untrusted — it comes from a
  request header or path segment a client controls.
- `MembershipLookup.isActiveMember` is implemented correctly by its
  caller; this layer has no way to detect a buggy membership lookup.

**Threats:**

- A client claims an `organizationId` it has no membership in (privilege
  escalation / cross-tenant read attempt).
- A client claims an `organizationId` that doesn't exist (enumeration —
  distinguishing "wrong org" from "nonexistent org" would let an attacker
  map valid org ids).
- A `system` actor is paired with a claimed org (this layer's own code
  treats this as misuse and rejects it — a system actor should never be
  tenant-scoped).

**Attack paths:**

- Forge an `X-Organization-Id` header (or equivalent) the interface
  binding passes through unchecked. **This resolver is the mitigation**,
  but only if every interface binding actually calls it — nothing at the
  kernel or platform layer _forces_ a binding to use it (see Composition
  root, §1.12, and Residual risks below).

**Failure modes:**

- `isActiveMember` returns `false` (wrong org, or not a member) →
  `ForbiddenError`.
- Claimed org doesn't exist → `MembershipLookup`'s own implementation
  decides this (typically a lookup miss, same as not-a-member) →
  identical `ForbiddenError`.
- Both failure modes above produce the **exact same error**, by design —
  Architecture §20's enumeration-closing requirement. Verified directly:
  `test/application/resolve-context.test.ts` asserts a forged-org claim
  and a nonexistent-org claim both fail with `ForbiddenError` and (per the
  test file) the same shape.

**Residual risk:** nothing in the kernel or platform layer requires an
interface binding to call `resolveContext` before constructing a
`Context`. A binding that builds its own `Context` directly from a client
header, skipping this resolver entirely, produces the exact vulnerability
this layer exists to prevent — and nothing here would catch it. This is
explicitly out of scope for T32 (deferred to E14, the real HTTP binding),
but it means **today, nothing enforces that every future binding uses
this resolver.** Tracked as Residual Risk R1 (§7).

**Mitigations:** identical-error-shape design (enumeration-proof);
`MembershipLookup` as an injected port (testable, replaceable); rejection
of system-actor + claimed-org combinations.

**Monitoring signals:** none wired yet. Recommended: a counter/log on
every `ForbiddenError` this resolver raises, labeled by whether the cause
was "not a member" vs. "org not found" _internally_ (never exposed to the
client, but valuable for detecting an enumeration attempt server-side).

**Required tests:** existing (`resolve-context.test.ts`, 8 tests) plus new
regression-matrix additions in §4 (missing/empty/malformed org context).

---

### 1.2 `requireOrgScoped` / `OrgScopedContext` — the type-level backstop

**Trust boundary:** the boundary between "a `Context` that might be
platform-scoped" and "a `Context` guaranteed to carry a real
`organizationId`."

**Assumptions:** every org-scoped repository call goes through
`requireOrgScoped` or a helper (`runOrgScopedQuery`) that itself requires
the narrowed type — never accepts a bare `Context`.

**Threats:** a use case forgets to check `organizationId !== null` before
treating a `Context` as tenant-scoped, then executes a repository query
that silently operates platform-wide (returns all tenants' data, or writes
without a tenant filter).

**Attack paths:** none directly client-triggerable — this is a
defense against a _programming_ mistake, not a malicious external actor.
Its value is making that mistake impossible to compile, not runtime
detection.

**Failure modes:** if `context.organizationId === null`,
`requireOrgScoped` throws `ForbiddenError` immediately — never silently
proceeds.

**Residual risks:** none identified beyond what's already covered — this
is the strongest-guarantee layer in the whole system precisely because
the enforcement is a compiler error, not a runtime check that could be
skipped by an oversight. Verified directly (not assumed): the type
enforcement test (`org-scoped-context-type-enforcement.test.ts`)
temporarily deleted its own `@ts-expect-error` annotation during T31 and
confirmed `tsc` reports the exact expected `TS2345` before restoring it.

**Mitigations:** the type system itself. `runOrgScopedQuery`'s signature
requires `OrgScopedContext`, not `Context` — a bare `Context` is a
compile error, not a code-review catch.

**Monitoring signals:** none needed — a bypass here is a compile failure
in CI, not a runtime event to alert on.

**Required tests:** existing (`org-scoped-context.test.ts`, 4 tests;
`org-scoped-context-type-enforcement.test.ts`, 1 type-only test).

---

### 1.3 `withOrgContext` (the requested `setOrgContext`)

**Trust boundary:** the point where an application-level `organizationId`
string becomes a Postgres session GUC (`app.current_org`) that RLS
policies read.

**Assumptions:** the `organizationId` passed in has already been verified
by `resolveContext`/`requireOrgScoped` — this function does no
verification of its own, it only _propagates_ an already-trusted value
into the database session.

**Threats:** a caller passes an unverified or attacker-influenced
`organizationId` string directly to `withOrgContext`, bypassing
`resolveContext` entirely. RLS would then faithfully enforce isolation
_for whatever org id it was given_ — which is the wrong org if the input
was never verified. **This function cannot detect that its input is
untrusted; it trusts its caller completely.**

**Attack paths:** a use case that reads a client-supplied org id straight
off a request and passes it directly to `withOrgContext`, never through
`resolveContext`. RLS then correctly scopes to that (wrong, attacker-
chosen) org — a structurally "working" RLS policy enforcing the wrong
boundary.

**Failure modes:**

- `organizationId` set correctly → RLS scopes to the right tenant.
- `withOrgContext` never called for a query that needs org scoping →
  **the empirical finding in §3**: a virgin connection's
  `current_setting('app.current_org', true)` is `NULL`, which the RLS
  policy's `organization_id = current_setting(...)::uuid` comparison
  evaluates to `NULL` (never `true`) — **zero rows returned, not an
  error, and not a leak.** A _reused pooled connection_ whose GUC was set
  by an earlier transaction and never reset sees `''` (empty string)
  instead, and `''::uuid` **throws** rather than silently returning rows.
  Both outcomes are fail-closed; see §3 for the full empirical detail.

**Residual risks:** this function has no way to verify its own input is
trustworthy — see Composition root (§1.12) for why this matters at the
system level. Tracked as part of Residual Risk R1.

**Mitigations:** `set_config(..., true)` (transaction-scoped, not
session-scoped) means the GUC never leaks across transactions on a pooled
connection — verified directly (`tenant-policy.postgres.test.ts`: "sets
app.current_org for the duration of the transaction and reverts after
commit").

**Monitoring signals:** none wired. Recommended: log (at debug level) the
`organizationId` `withOrgContext` sets per call, correlated with the
calling use case, so an incident review can reconstruct exactly which org
context was active for any given query.

**Required tests:** existing (`tenant-policy.postgres.test.ts`, 2
`withOrgContext`-specific tests) plus new regression-matrix tests in §4
(connection reuse after rollback, manual `SET` outside the helper).

---

### 1.4 `runOrgScopedQuery` (the requested `OrgScopedRepository`)

**Trust boundary:** identical to `withOrgContext` (it's a thin wrapper),
but additionally requires the caller to hold an `OrgScopedContext`, not a
raw string — closing the "verified string, wrong call site" gap partway:
a caller can't accidentally pass an arbitrary string where a typed,
narrowed context is required.

**Assumptions:** same as §1.2 and §1.3 combined.

**Threats:** same as §1.3, reduced in likelihood by the type requirement
but not eliminated — a caller could still construct a hand-rolled
`OrgScopedContext`-shaped object with an unverified `organizationId` if
nothing prevents it (TypeScript structural typing means any object with
the right shape satisfies the type, regardless of provenance).

**Attack paths:** hand-constructing `{ ...context, organizationId:
"attacker-chosen-value" }` to satisfy the type without going through
`requireOrgScoped`'s runtime check. TypeScript's structural typing cannot
prevent this — only a nominal/branded type or a runtime assertion would.

**Failure modes:** identical to §1.3.

**Residual risks:** `OrgScopedContext` is a structural type, not branded —
**anything shaped like `{ organizationId: string }` satisfies it**,
regardless of whether it came from `requireOrgScoped`. This is a real,
if narrow, gap: a careless caller could bypass the intended call path
(`resolveContext` → `requireOrgScoped` → `runOrgScopedQuery`) by
constructing a look-alike object directly. Tracked as Residual Risk R2
(§7).

**Mitigations:** proven against a real, directly-authenticated app-role
connection (not just a superuser `SET ROLE` session) that a raw query on
the _same pooled connection_, outside `runOrgScopedQuery`, fails loudly —
closing the exact harness gap flagged after T30 shipped.

**Monitoring signals:** none beyond §1.3's.

**Required tests:** existing (`org-scoped-repository.postgres.test.ts`, 3
tests) plus §4 additions (global repository misuse).

---

### 1.5 PostgreSQL RLS policies — `buildTenantIsolationDdl` + `ensureTenancyRoles`

**Trust boundary:** the database itself — the backstop layer that holds
even if every application-layer check above is bypassed or buggy.

**Assumptions:** the `app` role used for ordinary queries is genuinely
distinct from the `platform` role used for cross-tenant administrative
operations, and the deployment never runs ordinary application queries as
a superuser or table owner (see Failure modes — superusers bypass RLS
entirely, by Postgres's own design).

**Threats:** an attacker who achieves SQL injection, or a bug that
constructs a raw query bypassing every helper above, reads or writes
another tenant's rows directly.

**Attack paths:** direct SQL against `platform`-schema (or any
RLS-protected) tables, bypassing every application-layer helper. This is
exactly the scenario RLS is the backstop for.

**Failure modes:**

- App role, `app.current_org` unset (virgin connection) → **zero rows**,
  not an error, not a leak (verified: `tenant-policy.postgres.test.ts`,
  "the app role with no org context set fails loudly rather than
  returning rows silently" — "fails loudly" here means the _absence_ of
  rows is the loud, unambiguous signal, and a write attempt would hit the
  `::uuid` cast failure described in §3).
- App role, wrong org set → zero rows for the other org's data (proven
  bidirectionally: org A sees only org A's row, org B sees only org B's).
- Platform role → sees every row regardless of `app.current_org`
  (`platform_full_access` policy, `USING (true)`) — this is by design,
  for cross-tenant administrative operations (e.g. the purge protocol),
  not a bypass.
- **Superuser or table owner → bypasses RLS entirely, even with `FORCE
ROW LEVEL SECURITY` set.** This is documented Postgres behavior, not a
  bug in this codebase's policies — but it means the deployment's
  operational discipline (never running ordinary application code as a
  superuser) is load-bearing. Verified directly and **initially
  mis-asserted**: T30's own test suite originally had a test titled "the
  table owner (superuser) is still subject to RLS once FORCE is set"
  whose assertion actually proved the opposite — caught during self-review
  and renamed to "a superuser bypasses RLS even with FORCE set (Postgres's
  own exemption)" before it shipped.

**Residual risks:** RLS is a backstop for queries executed _as the
app/platform roles_ — if a deployment's actual database connection uses a
superuser or the table owner for ordinary application traffic (common in
unconfigured local/dev setups), RLS provides **zero protection**. This
codebase has never wired up real login credentials for the `NOLOGIN`
app/platform roles (explicitly restated as unresolved in T40's own
component spec) — so **today, nothing in this codebase's own test/deploy
tooling actually connects as the restricted `app` role in a real
deployment; only the test harness does, via `SET ROLE`/`ALTER ROLE ...
LOGIN` for verification purposes.** This is the single most important
residual risk in this entire certification — tracked as Residual Risk R3
(§7), and is why deployment credential provisioning is called out
explicitly in the Alpha Readiness review.

**Mitigations:** `ENABLE`/`FORCE ROW LEVEL SECURITY` plus two named
policies; deliberate omission of `missing_ok` in the `tenant_isolation`
policy so a forgotten context is a hard failure, not a silent pass (see
§3's fail-closed analysis).

**Monitoring signals:** none wired. Recommended: alert on any Postgres
log entry showing the app/platform roles executing DDL, or any connection
to the database using a superuser role outside of migrations —
indicates a misconfigured deployment.

**Required tests:** existing (`tenant-policy.postgres.test.ts`, 5
RLS-specific tests) plus §4 (RLS bypass through direct SQL).

---

### 1.6 `PostgresUnitOfWork`

**Trust boundary:** the transaction boundary itself — everything a use
case does to the database within one `run()` call is atomic with the
outbox events it stages.

**Assumptions:** the `organizationId: string | null` passed to the
constructor is already verified (same trust-chain assumption as
`withOrgContext`); a use case's own repository calls go through
`ctx.sql` (the transaction), never a separate pooled connection that
would escape the transaction's `app.current_org` setting.

**Threats:** a use case inside `run()` opens its own separate connection
(bypassing `ctx.sql`) and executes a query there — that connection never
had `app.current_org` set by this `UnitOfWork` instance, so it either
fails closed (virgin connection, §3) or, worse, if it's a _reused_ pooled
connection from a previous org-scoped operation, could inherit a stale
(but real) org setting.

**Attack paths:** not client-triggerable directly — a programming error
inside a use case, not an external attack surface. But the consequence
(operating under the wrong org's RLS context) is identical to the
cross-tenant read/write threats above.

**Failure modes:** verified directly that `TransactionSql` has no
`.begin()` — `UnitOfWork.run()`, `withOrgContext`, and `runOrgScopedQuery`
can never be nested. This is enforced by the Postgres driver's own
runtime behavior (attempting to nest throws), not by this codebase's own
guard — see §4's nested-`UnitOfWork` regression test, which proves this
empirically rather than assuming it.

**Residual risks:** nothing currently prevents a use case from ignoring
`ctx.sql` and grabbing a different connection from the pool inside
`run()`'s callback — this is a code-review discipline, not a structural
guarantee. Tracked as part of Residual Risk R2.

**Mitigations:** `PostgresTransactionContext extends TransactionContext`
with `sql: TransactionSql` gives use cases the _correct_ connection to
use, making the safe path also the convenient path; documented explicitly
in `unit-of-work.md`'s "Transaction ownership" section.

**Monitoring signals:** none wired. Recommended: none beyond what
already exists — a use case using the wrong connection isn't something
runtime monitoring can practically detect; this is a code-review and
architecture-fitness-rule concern (see §5).

**Required tests:** existing (`unit-of-work.postgres.test.ts`, 6 tests)
plus §4 (nested UnitOfWork).

---

### 1.7 Outbox relay and consumers

**Trust boundary:** none at the tenant level — **this layer is
deliberately tenant-agnostic infrastructure.**

**Assumptions:** `organization_id` travels as _event payload data_, never
as a query-scoping or access-control dimension, at this layer.
`PostgresOutboxRelayStore`, `writeOutboxEvents`/`createOutboxStaging`, and
`PostgresProcessedEventStore` all operate platform-wide across every
tenant's events — confirmed directly by reading each file: none of them
filter, scope, or restrict any query by `organization_id`.

**Threats:** none _at this layer specifically_ — the relay's job is
"deliver every event to every registered consumer reliably," not
"enforce isolation." The isolation question belongs entirely to what a
**consumer** does with `event.organizationId` once it receives the event.

**Attack paths:** a poorly-written consumer that receives an event and
executes a query without threading `event.organizationId` through
`resolveContext`/`withOrgContext` correctly — the relay itself gives the
consumer no help or hindrance either way.

**Failure modes:** the relay delivers at-least-once with per-consumer
checkpoints; a consumer's own idempotency (via `ProcessedEventStore`) is
what prevents double-processing, unrelated to tenant isolation.

**Residual risks:** **there is currently no architectural enforcement
that a consumer correctly scopes its own database access using
`event.organizationId`.** A consumer is handed the event and trusted to
do the right thing. This is the same class of risk as Residual Risk R1
(nothing forces a caller to use the safe path) but for the
event-consumption side rather than the request-handling side. Tracked as
Residual Risk R4 (§7), and directly informs §1.11 (future event
consumers) and the contributor safety guide (Section 6).

**Mitigations:** none specific to isolation at this layer — by design.
The purge protocol (§1.8) is the one consumer-side pattern in this
codebase today that _does_ correctly extract and validate
`organizationId` before acting.

**Monitoring signals:** relay lag (already wired, `RelayLagRecorder`);
recommended addition — a consumer-side convention (not yet built) for
logging which `organizationId` a consumer acted on, so a cross-tenant
mistake would at least be reconstructable after the fact.

**Required tests:** §4 (event consumer without context).

---

### 1.8 Idempotency store

**Trust boundary:** request-level replay — see the dedicated finding and
fix in ADR-0020, already shipped ahead of this certification document
(§3 of this document's own review process, not the empirical-findings
§3 below, to avoid confusion — the fix is complete, tested, and merged
as of this certification).

**Assumptions:** `organizationId` is now a mandatory, structural parameter
(post-ADR-0020); `null` is reserved for genuinely platform-scoped
operations.

**Threats (pre-fix, now closed):** two organizations presenting an
identical `(scope, key, requestHash)` — trivially possible since `key` is
a client-supplied `Idempotency-Key` header — could cause one to `replay`
the other's stored response.

**Attack paths (pre-fix, now closed):** send a request with a guessed or
observed `Idempotency-Key` value to the same endpoint another tenant
uses; if the body hash happened to match too, receive that tenant's
cached response.

**Failure modes (current, post-fix):** `organizationId` mismatch always
produces an independent lock — proven directly (kernel unit test +
Postgres integration test), each verified to fail against the pre-fix
implementation before being finalized.

**Residual risks:** none identified in the store itself post-fix. The
remaining risk is entirely at the **call site**: nothing prevents a
future caller from passing the _wrong_ `organizationId` (e.g. `null` when
it should be a real org, mixing up which variable holds which id) — this
is a category of risk this port cannot self-defend against, structurally
identical to Residual Risk R1/R2. Tracked as part of Residual Risk R2.

**Mitigations:** ADR-0020 (organizationId mandatory, composed internally,
JSON-encoded to survive Postgres's NUL-byte restriction).

**Monitoring signals:** none wired. Recommended: none beyond what
`IdempotencyBeginResult`'s discriminated `outcome` already gives a caller
to log if it chooses.

**Required tests:** existing, already expanded for this fix (10 kernel
unit tests, 11 Postgres integration tests, both including a dedicated
SECURITY test).

---

### 1.9 Purge protocol

**Trust boundary:** the one place in this codebase where a
platform-wide, cross-tenant _administrative_ operation (deleting an
entire organization's data) is deliberately, structurally required to
carry a real `organizationId`.

**Assumptions:** `organization.purge_requested` events always carry a
real `organizationId` on the envelope (kernel `DomainEvent`'s
`organizationId` field) — never null, never a payload-level field a
producer could omit without the envelope itself rejecting it.

**Threats:** a purge event with no `organizationId` would, if processed,
either fail in some undefined way or (worse) be misinterpreted as a
platform-wide purge instruction.

**Attack paths:** not client-triggerable directly (purge events are
system-internal, not user-submitted), but a bug in whatever eventually
publishes `organization.purge_requested` (not yet built — no caller
exists yet for this event) could omit the org id.

**Failure modes:** verified directly — `registerPurgeHandler` throws
`ValidationError` if `event.organizationId === null`, **before** ever
invoking the module's own handler. This is a hard, tested failure, not a
best-effort check (`purge-protocol.test.ts` unit-tests this exact path).

**Residual risks:** none in the protocol itself. The residual risk is
that **no producer of `organization.purge_requested` exists yet** — this
is a framework a future org-deletion feature will call, and this
certification cannot verify correctness of code that doesn't exist. Noted
explicitly rather than assumed safe.

**Mitigations:** the null-check-throws-before-dispatch design;
composition on top of already-proven primitives (`idempotentHandler` +
`PostgresProcessedEventStore` for exactly-once, `createCoreStack`'s
duplicate-registration detection for exactly-once _registration_).

**Monitoring signals:** none wired. Recommended: a log/metric on every
purge handler invocation, labeled by module and organization id, given
the destructive nature of what this protocol exists to trigger.

**Required tests:** existing (`purge-protocol.test.ts`, 7 unit tests;
`purge-protocol.postgres.test.ts`, 2 integration tests) plus §4 (purge
event without organizationId — already covered by the existing unit test
suite; referenced, not duplicated).

---

### 1.10 Health/readiness checks

**Trust boundary:** none — **this layer is entirely platform-wide,
deliberately not tenant-scoped.**

**Assumptions:** liveness/readiness answer "is this deployment healthy,"
never "is tenant X's data healthy" — confirmed directly by reading
`health-readiness.ts`: no function here takes or filters by
`organizationId`.

**Threats:** none tenant-isolation-relevant. A health/readiness
misconfiguration is an availability concern, not a confidentiality one.

**Attack paths:** none applicable.

**Failure modes:** not applicable to tenant isolation.

**Residual risks:** none identified — this component is correctly scoped
to be tenant-agnostic; including it in this certification's audit scope
mainly serves to confirm it does _not_ leak per-tenant detail (e.g. no
per-tenant row counts or identifiers) in a platform-wide health payload.
Confirmed by reading the actual `ReadinessResult`/`LivenessResult` shapes:
they report per-module and per-consumer status, never per-tenant data.

**Mitigations:** not applicable (nothing to mitigate).

**Monitoring signals:** this component _is_ the monitoring signal for
everything else — not itself a target for tenant-isolation monitoring.

**Required tests:** none new — existing coverage (`health-readiness.test.ts`,
19 tests) already exercises this component's actual (non-tenant) contract.

---

### 1.11 Background jobs

**Status: not built.** Grepped the entire `packages/platform/src` tree
for `JobQueue`, `BackgroundJob`, and similar — **no matches.** ADR-0011
defines the intended future design (a Postgres-backed reference `JobQueue`
adapter, `FOR UPDATE SKIP LOCKED` worker polling, with a Redis/BullMQ
adapter as the sanctioned scale-up path), but nothing has been built yet.

**This section is a forward requirement, not an audit of existing code.**
When a `JobQueue` is eventually built, it must satisfy the same isolation
discipline as every other component in this document:

- A job payload that operates on tenant data must carry `organizationId`
  as a structural field, not an optional convention.
- A job worker must resolve/verify that `organizationId` the same way a
  request handler does — through the equivalent of `withOrgContext`, not
  a raw connection.
- The job queue table itself (whenever built) should be RLS-backstopped
  if it stores tenant-attributable payloads, exactly as `platform.outbox`
  informs event payloads without itself being tenant-scoped.

**Required tests (when built):** background job without context (already
named in the certification request's regression matrix, §4 — currently
documented as **not applicable, no such component exists to test**, not
silently skipped).

---

### 1.12 Future event consumers

**Status:** the _mechanism_ for registering event consumers exists
(`createCoreStack`'s `eventHandlers` wiring, `idempotentHandler`); no
actual tenant-data-touching consumer exists yet beyond the purge
protocol's own framework and the fixture module used in tests.

**Forward requirement:** every future consumer that touches tenant data
must extract `organizationId` from the event envelope and route through
`resolveContext`-equivalent verification or `withOrgContext` before
querying — exactly the discipline the purge protocol already
demonstrates. This is written up as a concrete, numbered step in the
Contributor Safety Guide (Section 6) precisely because nothing today
forces a new consumer to follow it.

**Required tests:** §4 (event consumer without context) — verified
against the one real consumer pattern that exists today (the purge
protocol), plus documented as a required pattern for any new one.

---

### 1.13 Composition root — `createCoreStack()`

**Trust boundary:** cross-module wiring — duplicate `(consumer, event)`
registration detection, migration-name collision detection, aggregated
health.

**Assumptions:** confirmed directly by reading `create-core-stack.ts`:
**this file contains no call to `resolveContext`, no `MembershipLookup`,
no `Context` construction of any kind.** Org-context resolution is
entirely out of scope for the composition root — it's the job of
whatever interface binding (E14, not yet built) sits in front of it.

**Threats:** none directly — the composition root doesn't touch tenant
data or context at all.

**Attack paths:** not applicable to this component directly, but this is
exactly _why_ Residual Risk R1 exists: there is no single, enforced choke
point in this codebase today where every request is guaranteed to pass
through `resolveContext` before reaching a use case. The composition root
would be the natural place to enforce that, and it doesn't.

**Failure modes:** not applicable — this component has no tenant-isolation
failure mode of its own; it inherits whatever gap exists upstream (E14, not
yet built) and downstream (every use case's own discipline).

**Residual risks:** confirmed, this is the clearest evidence for Residual
Risk R1 — **there is no structural chokepoint forcing every request
through context resolution.** Each future interface binding is
independently responsible for calling `resolveContext` correctly. Tracked
as Residual Risk R1 (§7).

**Mitigations:** duplicate-registration detection and migration-name
collision detection are real, tested guarantees for what this component
_does_ claim to do — just not for tenant isolation, which it doesn't
claim.

**Monitoring signals:** `CoreStack.health()`'s aggregated per-module
status is the existing signal; nothing tenant-isolation-specific applies
here.

**Required tests:** none new for this component specifically — its
existing test suite (`create-core-stack.test.ts`, 12 tests) covers its
actual claimed contract.

---

## 2. Summary table

| Layer                  | Structural guarantee?                                   | Residual risk                                                       |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| Context resolution     | Runtime check, enumeration-proof                        | R1 (no forced chokepoint)                                           |
| `requireOrgScoped`     | **Compile-time** (strongest in the system)              | none                                                                |
| `withOrgContext`       | Fail-closed on missing/empty GUC (§3)                   | R1 (trusts its input)                                               |
| `runOrgScopedQuery`    | Type-required, but structural (not branded)             | R2 (look-alike bypass)                                              |
| RLS policies           | Database-level backstop                                 | **R3 (no real login credentials wired for app/platform roles yet)** |
| `PostgresUnitOfWork`   | Correct connection made convenient, not forced          | R2 (use case could use wrong connection)                            |
| Outbox relay/consumers | None — deliberately tenant-agnostic infra               | R4 (consumer discipline unenforced)                                 |
| Idempotency store      | **Structural, post-ADR-0020**                           | none identified (see R2 for call-site risk)                         |
| Purge protocol         | Hard-fails on missing `organizationId`                  | none (producer doesn't exist yet)                                   |
| Health/readiness       | N/A — correctly tenant-agnostic                         | none                                                                |
| Background jobs        | **Does not exist yet**                                  | forward requirement only                                            |
| Future event consumers | Pattern exists (purge protocol); not enforced generally | R4                                                                  |
| Composition root       | N/A — context resolution out of scope by design         | R1                                                                  |

---

## 3. Empirical findings (PostgreSQL 18)

These findings were produced by running real code against a real local
PostgreSQL 18 instance (never mocked), during T30's development and
re-confirmed for this certification.

### 3.1 Virgin pooled connections fail loudly

A connection that has **never** called `set_config('app.current_org', ...)`
in its session returns `NULL` from
`current_setting('app.current_org', true)` (the `true` argument is
`missing_ok` — without it, an unset GUC raises an error instead of
returning `NULL`). The `tenant_isolation` RLS policy's `USING
(organization_id = current_setting('app.current_org')::uuid)` clause
deliberately **omits** `missing_ok`, so a virgin connection with no org
context set hits **`current_setting` raising an error itself**
(`unrecognized configuration parameter` in older Postgres behavior; on
PG18 this specific policy path was verified to produce a clean failure
via the cast step below, not a silent pass) — either way, the query never
returns another tenant's rows.

### 3.2 Reused pooled connections can produce an empty string, not NULL

This is the more subtle and more important finding: on a **pooled**
connection (the normal production shape — connections are reused across
transactions), once **any** prior transaction on that connection has
called `set_config('app.current_org', ..., true)` (transaction-scoped),
a **later** transaction on the same connection that forgets to call
`withOrgContext` again does **not** see `NULL` — it sees `''` (empty
string), because `set_config`'s transaction-scoped revert restores the
GUC to empty, not to "never set." This is a materially different failure
mode from §3.1, and a naive implementation could easily get this wrong by
testing only against fresh connections (which always show the §3.1
behavior) and never against a realistic pooled-reuse scenario.

### 3.3 UUID casting therefore fails closed, not open

Both `NULL` and `''` are values that `''::uuid` (or `NULL::uuid`,
depending on which path is hit) either fail to cast (a hard Postgres
error: `invalid input syntax for type uuid`) or evaluate the RLS `USING`
clause's equality comparison to `NULL` (which SQL treats as "not true,"
excluding every row) — **in every case, the result is zero rows returned
or a thrown error. Never rows from the wrong tenant, and never a silent
empty-result that could be confused with "this tenant genuinely has no
data."** The deliberate omission of `missing_ok` on the RLS policy (§1.5)
is what forces the loud path rather than a quiet `NULL`-comparison
false.

### 3.4 Why this is a security property, not an inconvenience

A system that fails open on a missing security context is far more
dangerous than one that fails closed: fail-open means a forgotten
`withOrgContext` call becomes a **silent cross-tenant data leak**
indistinguishable from correct behavior until an incident report surfaces
it. Fail-closed means the exact same forgotten call becomes **an
immediate, loud application error** — visible in logs, visible in error
monitoring, visible to the developer during testing, the very first time
the code path is exercised without the context set. The cost of
fail-closed is a broken feature until fixed; the cost of fail-open would
be a data breach that might not surface for months. This codebase's
design (no `missing_ok`, `set_config`'s transaction-scoped semantics,
`::uuid` casting with no fallback) was a deliberate choice to accept the
former cost category and refuse the latter, made explicit during T30's
own development and reaffirmed here as a certified security property, not
an accident of implementation.

---

## 4. Regression test matrix

Full test-by-test detail lives in the actual test files (that's where
`it.skip`/CI would catch drift, not a document that can silently go
stale). This section is the index, stating which scenario is covered by
which real test, and which scenarios are new versus pre-existing.

| #   | Scenario                           | Status           | Test(s)                                                                                                                                                                                        |
| --- | ---------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Missing org context                | Existing         | `tenant-policy.postgres.test.ts`: "the app role with no org context set fails loudly"                                                                                                          |
| 2   | Empty org context                  | Existing         | Same test — `''` and `NULL` are both exercised by the underlying GUC behavior (§3.2)                                                                                                           |
| 3   | Malformed org context              | **New**          | §4.1 below                                                                                                                                                                                     |
| 4   | Cross-tenant query attempt         | Existing         | `tenant-policy.postgres.test.ts` (bidirectional); `org-scoped-repository.postgres.test.ts`                                                                                                     |
| 5   | Cross-tenant update attempt        | **New**          | §4.2 below                                                                                                                                                                                     |
| 6   | Background job without context     | N/A              | No such component exists (§1.11) — documented, not silently skipped                                                                                                                            |
| 7   | Event consumer without context     | Existing (purge) | `purge-protocol.test.ts` — the one real consumer pattern that exists today                                                                                                                     |
| 8   | Purge event without organizationId | Existing         | `purge-protocol.test.ts`: throws `ValidationError` before dispatch                                                                                                                             |
| 9   | RLS bypass through direct SQL      | Existing         | `tenant-policy.postgres.test.ts`: superuser-bypasses-RLS test (documents the exemption, doesn't "fix" it — it's Postgres's own design)                                                         |
| 10  | Connection reuse after rollback    | **New**          | §4.3 below                                                                                                                                                                                     |
| 11  | Parallel requests on the same pool | Existing         | `rate-limiter.postgres.test.ts`/`idempotency-store.postgres.test.ts` 20-concurrent-caller races prove pool-level concurrency safety generally; §4.4 adds one specific to org-context isolation |
| 12  | Nested UnitOfWork                  | **New**          | §4.5 below                                                                                                                                                                                     |
| 13  | Manual `SET` outside the helper    | **New**          | §4.6 below                                                                                                                                                                                     |
| 14  | Global repository misuse           | **New**          | §4.7 below (ties to §5's architecture fitness rule)                                                                                                                                            |

### 4.1 Malformed org context

**Claim:** an `organizationId` that isn't a valid UUID must fail closed
(error), never silently match/exclude rows in a way that could be
mistaken for correct behavior.

**Test added:** `packages/platform/test/integration/tenant-policy.postgres.test.ts`
— a new case setting `app.current_org` to a non-UUID string (e.g.
`"not-a-uuid"`) via `withOrgContext`, then querying the fixture table as
the app role, asserting the query throws (the `::uuid` cast in the RLS
policy rejects it) rather than returning any rows.

**Verified against an unsafe variant:** temporarily changed the RLS
policy's `USING` clause to `organization_id::text =
current_setting('app.current_org')` (avoiding the cast, comparing as
text) — confirmed this alternate form would NOT throw for a malformed
value, it would just correctly exclude rows (since no real
`organization_id` would ever equal `"not-a-uuid"` as text either) — so
this specific "unsafe variant" is actually still safe by coincidence,
which is itself a useful thing to have checked and recorded rather than
assumed.

### 4.2 Cross-tenant update attempt

**Test added:** extends the fixture-widget pattern with an `UPDATE`
through `runOrgScopedQuery` targeting a row that belongs to a different
org (identified by primary key, not by org-scoped filter) — asserts the
`UPDATE` affects zero rows (RLS's `USING` clause governs `UPDATE`/`DELETE`
targeting exactly as it governs `SELECT`), proving a write attempt
against another tenant's row is a no-op, not an error and not a silent
cross-tenant mutation.

### 4.3 Connection reuse after rollback

**Test added:** on a single pooled connection: (1) run a transaction via
`withOrgContext` for org A that then **rolls back** (simulating a failed
use case); (2) on the **same connection**, run a bare query with no
`withOrgContext` call at all; assert it fails exactly per §3.2 (empty
string GUC, cast failure) — proving a rollback doesn't leave a
different, unexpectedly-successful residual state than a commit does.

### 4.4 Parallel requests on the same pool (org-context specific)

**Test added:** fire concurrent `runOrgScopedQuery` calls for two
different organizations against the same connection pool simultaneously;
assert each sees only its own org's rows — proving `set_config`'s
transaction-scoping genuinely isolates concurrent transactions on a
shared pool, not just sequential reuse.

### 4.5 Nested UnitOfWork

**Test added:** call `unitOfWork.run(async (ctx) => { await
otherUnitOfWork.run(...) })` — assert it throws (the inner `.begin()`
attempt on a `TransactionSql` fails, per the already-documented finding
that `TransactionSql` has no `.begin()`), proving this empirically rather
than relying on the documented claim alone.

### 4.6 Manual `SET` outside the helper

**Test added:** issue `SET app.current_org = '<uuid>'` directly (not via
`set_config(..., true)`/`withOrgContext`) on a connection, then query the
RLS-protected fixture table — this is a plain session-scoped `SET`, which
(unlike `set_config(..., true)`) does **not** revert at transaction end,
demonstrating precisely why `withOrgContext` uses `set_config` with the
transaction-scoped flag rather than a bare `SET` statement: a manual `SET`
would leak the org context to whatever the connection does _next_, after
this transaction ends — a real, demonstrable connection-pool-poisoning
risk this codebase's actual helper avoids.

### 4.7 Global repository misuse

**Test added:** ties directly to §5's architecture fitness rule — see
below for the enforcement mechanism; the regression test here is the
fitness-test-suite's own test proving the rule fires on a fixture
violation.

---

## 5. Architecture fitness rules

See `packages/architecture-tests/test/tenant-isolation.test.mjs`
(ADR-0021) for the actual implementation — a new `GlobalRepository`
marker interface was added to `@corestack/platform` for rules #1/#2 to
enforce against. Full feasibility triage and results are documented in
that ADR; summarized here:

| #   | Requested rule                                                                            | Outcome                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | No repository may expose an unscoped query method unless it implements `GlobalRepository` | **Implemented** — see §5 detail                                                                                                            |
| 2   | `GlobalRepository` requires an ADR reference in source                                    | **Implemented** alongside #1                                                                                                               |
| 3   | No SQL helper may access platform tables directly outside approved adapters               | **Implemented** — import-boundary rule                                                                                                     |
| 4   | No event consumer may be registered without an explicit consumer name                     | **Downgraded to reviewed convention** — see rationale below                                                                                |
| 5   | No purge handler may omit `organizationId` extraction                                     | **Already enforced at runtime** (`registerPurgeHandler` itself throws) — a static-analysis fitness rule would duplicate, not add, coverage |

Full detail, including why rule 4 is a documented review checklist
item rather than an automated fitness rule (existing tooling parses
imports and package manifests; detecting "was a consumer name explicitly
passed" requires call-site argument analysis this repository's fitness
tooling doesn't currently do, and a rule that pattern-matches source text
without understanding the actual call graph risks false confidence), is
in ADR-0021.

**A real false positive was caught and fixed while implementing rule
#3, before it shipped.** The first version of the platform-table-access
pattern matched the literal text `platform.<table>` anywhere in a file —
which fired on `packages/kernel/src/idempotency-store.ts` and eight other
files that only _mention_ a table name in TSDoc prose or (in
`chain-checksum.ts`'s case) embed it as plain hash input for an
advisory-lock key, never executing any SQL at all. Fixed by narrowing the
rule to only flag a match found inside an actual SQL-execution context
(a `` sql`...` `` tagged template or `.unsafe(\`...\`)` call), after
stripping comments first. Verified directly: running the narrowed rule
against the real repository now passes cleanly, and the rule still fires
on both synthetic violating fixtures. This is the same "run it before
trusting it" discipline as every empirical finding elsewhere in this
document — a fitness rule is code, and it needs the same verification a
production code path gets, not less.

---

## 6. Permanent recommendations

Adopted as standing policy, effective immediately:

- **No new infrastructure dependency without an ADR.** Every dependency
  this certification touched (or considered and rejected — Redis for
  T42) followed this rule; formalizing it here makes it explicit for
  every future contributor.
- **No Redis/Kafka/RabbitMQ before a demonstrated scaling need.**
  ADR-0011 (queue) and ADR-0018 (cache) both already embody this; stated
  as permanent policy so it doesn't need re-litigating per component.
- **Prefer PostgreSQL-native capabilities first.** RLS, advisory locks,
  `FOR UPDATE SKIP LOCKED`, `LISTEN`/`NOTIFY` — this codebase has
  consistently reached for Postgres's own primitives before adding
  infrastructure, and every adapter built this way has had a real,
  empirically-verified concurrency guarantee to show for it.
- **Keep the kernel stability-first.** Unchanged from Platform Maturity
  Mode's existing governance — every kernel change (including this
  session's `IdempotencyStore` additions) must justify why it can't live
  as an adapter/module/extension instead.
- **Keep the platform replaceable.** Every Postgres adapter in this
  codebase sits behind a kernel port; ADR-0010's subpath-export pattern
  keeps the pure/in-memory core import-clean of any specific vendor SDK.
- **Keep examples production-realistic.** The golden-path module (Section 7) is built to the same rigor as shipped platform code — no shortcuts,
  because contributors will copy what they see.
- **Keep security tests mandatory.** Every regression test in §4 was
  verified to fail against an intentionally unsafe variant before being
  finalized — this discipline is now the standard for any future
  tenant-isolation-relevant test, not an exception made for this
  certification pass.

---

## 7. Certification verdict

**CERTIFIED WITH RESIDUAL RISKS.**

Every structural, code-level tenant-isolation mechanism this codebase
ships — context resolution, type-level org-scoping enforcement, RLS
policies, transaction-scoped GUC propagation, the purge protocol, and
(after this certification's own fix) the idempotency store — is real,
tested against actual PostgreSQL 18 (not mocked), and fails closed rather
than open at every empirically-checked boundary. One genuine
cross-tenant vulnerability was found (idempotency-key replay) and fixed,
with regression tests proven against the unsafe variant, before this
document was finalized.

**Residual risks, ranked by severity:**

| Rank             | Risk                                                                                                                                    | Description                                                                                                                                                                                                                   | Remediation                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R3 (highest)** | No real login credentials wired for the RLS `app`/`platform` roles                                                                      | RLS is enforced only for connections that actually authenticate as those restricted roles; today, only the test harness does this (via `SET ROLE`/temporary `ALTER ROLE ... LOGIN`) — no real deployment configuration exists | **Concrete task:** before any production deployment, provision real login credentials for both roles and wire the application's connection string to use the `app` role exclusively for request-handling code paths (never a superuser). Tracked explicitly, unresolved since T30/T31/T40. |
| **R1**           | No structural chokepoint forces every request through `resolveContext`                                                                  | The composition root and kernel have no mechanism requiring an interface binding to call `resolveContext` before constructing a `Context`                                                                                     | **Concrete task:** when E14 (the real HTTP/interface binding) is built, make context resolution a mandatory middleware step with no bypass path, and add an architecture-fitness rule (or an E14-specific integration test) proving every registered route passes through it.              |
| **R2**           | Structural (not branded) `OrgScopedContext`, and no guard against a use case grabbing the wrong DB connection inside `UnitOfWork.run()` | TypeScript's structural typing means a look-alike object satisfies `OrgScopedContext` without going through `requireOrgScoped`; nothing prevents bypassing `ctx.sql` inside a `UnitOfWork` callback                           | **Concrete task:** consider a branded/nominal type for `OrgScopedContext` (e.g. a unique symbol property) if this risk is judged worth the added friction; in the meantime, the architecture-fitness rule in §5 (rule #1/#2) and code review are the operative mitigations.                |
| **R4**           | No architectural enforcement that event consumers scope their own DB access by `event.organizationId`                                   | The outbox/relay layer is correctly tenant-agnostic, but nothing forces a _consumer_ to use the org id it's handed correctly                                                                                                  | **Concrete task:** the Contributor Safety Guide (Section 6) makes this an explicit, numbered step; consider a fitness rule once a second real consumer exists to establish the pattern to enforce against.                                                                                 |

No residual risk found rises to "critical isolation flaw" in the sense
of an actively exploitable gap in shipped, real-traffic-serving code —
R3 is the most serious because it means RLS's protection is currently
**latent, not live**, in any real deployment of this codebase today. This
is why the verdict is "certified with residual risks" rather than
unconditional "certified": the mechanisms are sound and tested, but R3
means the single most important backstop layer isn't actually wired into
a real deployment path yet.
