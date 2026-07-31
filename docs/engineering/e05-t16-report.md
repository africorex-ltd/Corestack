# E05-T16 — Tenancy JSON Delivery Payload Adapter: Completion Report

- **Date:** 2026-07-31
- **Scope:** founder directive "Begin E05-T16 only. Do not integrate
  SendGrid, SES, Postmark, SMTP, or any external network service."
  Sections 1–14.
- **Verdict:** **Complete** — a `NotificationWorkItem` can be converted
  into a stable, provider-agnostic, durable, replay-safe JSON payload; no
  network I/O anywhere in this task.

## What shipped

`packages/tenancy/src/application/notification-delivery-payload.ts`
(`NotificationDeliveryPayload` + `buildNotificationDeliveryPayload` +
`NOTIFICATION_TEMPLATE_BY_TYPE`/`NOTIFICATION_SUBJECT_BY_TYPE`),
`notification-delivery-payload-repository.ts` (the port); Postgres adapter
`postgres-notification-delivery-payload-repository.ts` + mapper
`mappers/notification-delivery-payload-mapper.ts`; migration
`migrations/tenancy/0005_create-notification-delivery-payloads.sql`;
`src/infrastructure/postgres/notification-payload-delivery-adapter.ts`
(`deliverNotificationWorkItemAsJsonPayload` — the one exported entry
point).

Full design writeup:
[docs/modules/tenancy-delivery-payloads.md](../modules/tenancy-delivery-payloads.md)
(payload schema, determinism guarantees, template/variable contracts,
persistence design, why this isn't a `NotificationDeliveryPort`
implementation, future provider integration).

**Tests:** 17 new unit tests (10 pure builder tests in
`test/application/notification-delivery-payload.test.ts`, 7
migration-consistency tests) and 8 new integration tests in
`test/integration/tenancy-postgres.postgres.test.ts`'s new `"JSON
delivery payload adapter (E05-T16)"` describe block, run against real
PostgreSQL: durable persistence, real-column projection, template mapping
for all three types, variable/metadata mapping, deterministic JSON,
replay safety, and a `findById` miss.

## Determinism by construction, not by a serializer — the one design decision that mattered

The first draft of this task minted a fresh `IdGenerator.generate()` and
`clock.now()` per build — natural-sounding ("this payload was created
just now"), but fatal to Section 3's "make the JSON deterministic" and
Section 8's "replay safety": a builder keyed by a random id produces a
different row every time it's called for the *same* work item, which
cannot be replayed or deduplicated after the fact. An advisor pass caught
this before any code was written for it, and before reaching for the
obvious-looking fix (a canonical, key-sorting JSON serializer) — sorting
keys makes one call's output internally consistent, but does nothing
about two calls producing *different* output for the same input.

The actual fix: `buildNotificationDeliveryPayload(item)` reuses the
source work item's own `id` and `createdAt` verbatim, needs no
`IdGenerator`/`Clock` at all, and is a pure function of its one input.
That single change makes the builder deterministic (`JSON.stringify`
twice on the same item is byte-identical, no extra serializer code
needed) and makes `store`'s `INSERT ... ON CONFLICT (id) DO NOTHING` a
true idempotent upsert rather than a plain insert that would need a
separate dedup mechanism bolted on. Simpler than the design it replaced,
not just more correct.

## Deliberately not an implementation of `NotificationDeliveryPort`

E05-T15's `NotificationDeliveryPort` methods (`deliverInvitationCreated`/
`Accepted`/`Expired`) each take a narrow, per-type payload —
`organizationId`/`invitationId`/`recipient` only, deliberately excluding
`id`/`createdAt` (T15's own "no internal repository details" rule). This
task's payload needs exactly those two fields to be deterministic —
fields the port's signatures never receive. Changing the port would touch
T15's already-shipped, tested contract for a need only this task's
downstream artifact has; this task's own Section 2 scope doesn't ask for
that change. Instead, the adapter takes a bare `NotificationWorkItem`
directly (which `processNextNotificationWorkItem` already has in hand)
and is not wired into that processor by this task — a composition
decision left for whichever future task builds a real provider adapter,
once there's a real reason to compose "build+store, then send" into one
step. See the design doc's dedicated section for the full reasoning and
the two alternatives considered and rejected.

## Real design decisions beyond the literal Section 6 column list

Section 6 lists exactly four things to store: payload JSON, notification
type, recipient, createdAt. This task also promotes `organization_id` to
a real, indexed, RLS-scoped column — not asked for in that literal list,
but required by this codebase's own standing tenant-isolation policy
(ADR-0008): every durable tenancy table carries one, and a table holding
one row per tenant-scoped notification with no way to enforce or query
per-organization visibility would be a silent regression of that policy.
RLS reuses `buildOrgScopedTableRlsDdl` verbatim (same generator 0002/0003
already use), verified byte-for-byte in
`test/infrastructure/migration-notification-delivery-payloads-consistency.test.ts`.
`PostgresNotificationDeliveryPayloadRepository` implements
`GlobalRepository`, citing ADR-0026 — the same "background adapter, no
`OrgScopedContext`" reasoning `PostgresNotificationWorkItemRepository`
already established, applied to a sibling table with an identical caller
shape. The application-layer port passes ADR-0021's fitness rule the same
way `notification-work-item-repository.ts` does (mentioning
`OrgScopedContext` in prose), with the same fragility note pointing back
to ADR-0026.

## Quality gate

All green, repo-wide:

- `turbo run build typecheck` — 4/4 tasks (kernel/platform/tenancy build +
  tenancy typecheck).
- `eslint packages/tenancy packages/architecture-tests` — zero findings.
- `turbo run build typecheck test` — 14/14 tasks pass, including
  tenancy's full 496-test unit suite across 44 files (up from 479/42).
- `pnpm --filter @corestack/tenancy test:integration` — 58/58 tests pass
  (up from 49), run twice against a real local PostgreSQL 18 instance to
  confirm stability.
- Architecture-fitness suite — 36/36 across 5 files, unchanged (the new
  repository passes ADR-0021's rule on the first attempt, citing
  ADR-0026 — no fitness-fix cycle needed this time, unlike E05-T14).
- Export-surface snapshot — updated for the new
  `PostgresNotificationDeliveryPayloadRepository`/
  `deliverNotificationWorkItemAsJsonPayload`/mapper exports (`./postgres`)
  and `NOTIFICATION_TEMPLATE_BY_TYPE`/`NOTIFICATION_SUBJECT_BY_TYPE`/
  `buildNotificationDeliveryPayload` (main entry); re-verified against the
  actual diff (only the expected new symbols appeared).

## Permanent policy reaffirmed (Section 10)

Providers consume stable payloads; payloads are provider-agnostic;
serialization is deterministic; delivery is auditable (every stored
payload carries its `organizationId` and is timestamped); replay uses
stored payloads (`findById` plus idempotent `store`) — all five describe
exactly what this task built.

## What's still open, not resolved here

- **Real email delivery, any external provider integration.** Explicitly
  out of scope — `NotificationDeliveryPort` still has exactly one
  implementation anywhere in this codebase, the in-memory test adapter;
  this task's own delivery payload adapter makes zero network calls.
- **Composing the payload adapter into `processNextNotificationWorkItem`.**
  Not done by this task — see "Deliberately not an implementation of
  `NotificationDeliveryPort`" above. Nothing calls
  `deliverNotificationWorkItemAsJsonPayload` today except this task's own
  tests.
- **A query for "unsent" or "unconfirmed" payloads.** Nothing yet marks a
  stored payload as sent — that state doesn't exist until a real provider
  adapter needs it. `findById` is the only read method, added because
  this task's own tests and a future provider's replay path both need it.
- **The crashed-worker `PROCESSING`-orphan gap** (E05-T15). Unrelated to
  and unaffected by this task; still open, still documented.
- **Release-pipeline debt** (recurring, tracked across every prior report
  in this sequence): `@corestack/tenancy` remains `0.0.1`, no
  changeset — this task adds new exported surface to `./postgres`; still
  not cut into a release.

## Next

**E05-T17**: not yet specified by the founder directive sequence. Not
started. Per Section 14, work stops here pending the next prompt — no
real provider integration started automatically.
