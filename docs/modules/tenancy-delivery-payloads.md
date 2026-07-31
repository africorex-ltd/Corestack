# Tenancy Delivery Payloads (E05-T16)

- **Scope:** founder directive "Begin E05-T16 only. Do not integrate
  SendGrid, SES, Postmark, SMTP, or any external network service."
  Sections 1–14.
- **Goal:** convert a `NotificationWorkItem` (E05-T14) into a stable,
  provider-agnostic JSON payload and store it durably — no network I/O
  anywhere in this task.

## Payload schema (Section 3)

```ts
interface NotificationDeliveryPayload {
  readonly id: string;
  readonly notificationType: NotificationWorkItemType;
  readonly recipient: string | null;
  readonly subject: string;
  readonly template: string;
  readonly variables: { readonly invitationId: string };
  readonly metadata: { readonly organizationId: string };
  readonly createdAt: Date;
}
```

Built by one pure function:

```ts
buildNotificationDeliveryPayload(item: NotificationWorkItem): NotificationDeliveryPayload
```

`packages/tenancy/src/application/notification-delivery-payload.ts` — no
`IdGenerator`, no `Clock`, no repository, no I/O of any kind. Every field
is either copied straight from the source work item (`id`, `notificationType`
← `type`, `recipient`, `createdAt`) or derived purely from its `type`/
`invitationId`/`organizationId` (`subject`, `template`, `variables`,
`metadata`).

## Determinism guarantees (Section 3/8) — a property of the builder, not a serializer

**`id` is the source work item's own `id`. `createdAt` is the source work
item's own `createdAt`.** Neither is freshly minted. This is the load-bearing
decision in this task's design, and it was not the first draft — the first
draft generated a fresh UUID and `clock.now()` per build, which reads
naturally ("this payload was created just now") but is fatal to two things
Section 3/8/10 explicitly ask for:

- **"Make the JSON deterministic."** A builder that mints a random id and a
  fresh timestamp on every call produces different JSON for the *same*
  work item every time. Determinism cannot be bolted onto that after the
  fact by sorting object keys — a canonical serializer would make two
  calls' output *internally* consistent (fields in the same order) while
  still being *different from each other* (different id, different
  timestamp), which is not what "deterministic" means here.
- **"Replay uses stored payloads" / Section 8's "replay safety."** If
  `store` is called twice for what is conceptually "the same delivery" (a
  worker retries after a crash, a future caller re-derives a payload for
  an already-processed item), a non-deterministic builder makes those two
  calls produce two unrelated rows — there is no way to recognize them as
  the same thing after the fact.

Making the builder a pure function of its one input (`item`) fixes both:
the same work item always builds byte-identical JSON
(`test/application/notification-delivery-payload.test.ts`, "is
deterministic" test), and `store`'s `id` column is naturally the right key
for an idempotent upsert (see below) — no separate dedup mechanism needed.

**Consequence, accepted deliberately:** the payload table's primary key
equals the source work item's primary key. This is not treated as a
Section 5 "internal repository details" leak — Section 5 constrains what
goes into `variables`/`metadata` (customer-facing/audit content), not the
row's own identity, and a durable, replayable artifact needs *some* stable
identity; deriving it from the one input that already uniquely identifies
"this notification" is simpler and more honest than minting a second,
unrelated id for the same concept.

## Template contract (Section 4)

```ts
const NOTIFICATION_TEMPLATE_BY_TYPE: Record<NotificationWorkItemType, string> = {
  INVITATION_CREATED: "invitation-created",
  INVITATION_ACCEPTED: "invitation-accepted",
  INVITATION_EXPIRED: "invitation-expired",
};
```

Typed as `Record<NotificationWorkItemType, string>` — the full union, not
`Record<string, string>` — so adding a fourth `NotificationWorkItemType`
without updating this map is a **compile error**, not a silent `undefined`
template at runtime. The subject map (`NOTIFICATION_SUBJECT_BY_TYPE`) is
typed identically, and both live in the same file so the pair is
obviously meant to stay exhaustive together. Subjects are the placeholder
strings Section 4 explicitly permits ("Subjects may be simple placeholders
for now") — plain English, no interpolation.

## Variable contract (Section 5)

Two separate slots, not two names for the same bag:

- **`variables`** — what a rendered template interpolates into the
  message body. Today: `{ invitationId }` only. Nothing else is available
  without a repository read this pure builder cannot perform (an
  organization display name, an inviter's name) — Section 5: "Include
  only the variables needed by future providers. Do not include internal
  repository details."
- **`metadata`** — operational/audit context a provider might use for
  tagging or routing, not customer-facing content. Today: `{
  organizationId }` only.

Neither ever carries `status`/`attempts`/`processedAt`/`lastError` — those
are `notification_work_items` queue bookkeeping with no meaning to a
delivery provider, and this builder never reads them off `item` at all.

**`recipient: null` is a fact this payload carries forward, not a defect
in it.** `INVITATION_ACCEPTED`/`INVITATION_EXPIRED` work items have no
recipient (E05-T14's own documented choice — resolving one would require
a repository read this task's own Section 5 forbids), so their payloads
have `recipient: null` too. **A future real provider adapter reading a
stored payload with `recipient: null` cannot deliver it as an email** — it
must have its own resolution strategy (e.g., a fresh repository read at
send time to find the organization's admin/owner) or an explicit rejection
path. This payload's job is to be a faithful, deterministic projection of
the work item, not to paper over a gap that exists upstream of it.

## Persistence (Section 6)

`tenancy.notification_delivery_payloads`
(`migrations/tenancy/0005_create-notification-delivery-payloads.sql`):

| Column              | Type        | Note                                                  |
| ------------------- | ----------- | ------------------------------------------------------ |
| `id`                | `uuid` PK   | = the source work item's `id`                          |
| `organization_id`   | `uuid` NN   | FK → `tenancy.organizations`, `ON DELETE CASCADE`       |
| `notification_type` | `text` NN   | `CHECK` against the same three types as `notification_work_items` |
| `recipient`         | `text`      | nullable, matching the domain model                    |
| `payload`           | `jsonb` NN  | the full `NotificationDeliveryPayload`, source of truth |
| `created_at`        | `timestamptz` NN | = the source work item's `createdAt`               |

`organization_id`/`notification_type`/`recipient`/`created_at` are real,
indexed columns *derived from* the same in-memory payload at write time —
Section 6's literal list, promoted out of the jsonb blob for querying and
(in `organization_id`'s case) RLS. **`organization_id` is not one of
Section 3's payload fields** (the payload model's only tenant-identifying
value lives inside `payload.metadata.organizationId`) — it is added as a
real column anyway because every durable tenancy table in this module
carries one (ADR-0008's tenant-isolation permanent policy); a table
holding one row per tenant-scoped notification with no way to enforce or
query per-organization visibility would be a silent regression of that
policy that Section 6's short column list did not intend to create.

RLS reuses `buildOrgScopedTableRlsDdl` verbatim — the same generator
0002/0003 already use, verified byte-for-byte against the shipped
migration in
`test/infrastructure/migration-notification-delivery-payloads-consistency.test.ts`.
`tenancy_app`'s `UPDATE` grant is unused today (this table is only ever
inserted and read) — the same "future-proofing, matches every other
tenancy table" tradeoff 0003 already accepted for its own unused `UPDATE`
grant.

### `store` is an idempotent upsert (Section 8: "replay safety")

```sql
INSERT INTO tenancy.notification_delivery_payloads (...)
VALUES (...)
ON CONFLICT (id) DO NOTHING
```

Because the builder is a pure function of the source work item, two calls
for the same item always produce the identical row under the identical
`id` — `DO NOTHING` makes a second `store` call a true no-op, not a
constraint-violation error and not a wasteful overwrite. This is the
mechanism, not just the claim: `test/integration/tenancy-postgres.postgres.test.ts`'s
"replay safety" test calls the adapter twice for the same item and asserts
exactly one row exists afterward.

### `GlobalRepository`, citing ADR-0026

`PostgresNotificationDeliveryPayloadRepository` implements
`GlobalRepository` and cites **ADR-0026** — the same reasoning that ADR
establishes for `PostgresNotificationWorkItemRepository` (no authenticated
caller, no `app.current_org` to set, visibility via the elevated
`tenancy_platform` role) applies unchanged here: this repository's only
caller is the JSON delivery adapter below, operating on a bare
`NotificationWorkItem`, not a per-request `OrgScopedContext`. The
application-layer port (`notification-delivery-payload-repository.ts`)
passes the same architecture-fitness rule (ADR-0021) the same way
`notification-work-item-repository.ts` does — by mentioning
`OrgScopedContext` in prose to explain why it *isn't* one. Both files'
own doc comments flag this text-match fragility explicitly; see
`notification-work-item-repository.ts`'s identical note.

## The adapter (Section 7)

```ts
deliverNotificationWorkItemAsJsonPayload(
  item: NotificationWorkItem,
  deps: { sql: Sql },
): Promise<{ success: true; payloadId: string }>
```

`packages/tenancy/src/infrastructure/postgres/notification-payload-delivery-adapter.ts`.
Receives a work item, builds its payload, stores it (one elevated
`PostgresUnitOfWork` transaction, same `SET LOCAL ROLE tenancy_platform`
shape `process-notification-work-item.ts` and
`invitation-notification-consumer.ts` already established), and returns
`{ success: true }`. No network I/O anywhere in this file.

### Deliberately not an implementation of `NotificationDeliveryPort` (E05-T15)

This is the one design decision in this task worth being explicit about,
because it looks at first glance like a missed connection rather than a
boundary respected on purpose.

`NotificationDeliveryPort`'s three methods (`deliverInvitationCreated`/
`Accepted`/`Expired`) each take a narrow, per-type payload —
`organizationId`/`invitationId`/`recipient` only (see
`application/notification-delivery-port.ts`) — deliberately excluding the
work item's own `id` and `createdAt` (T15 Section 5: "do not include
internal repository details"). This task's payload needs exactly those
two fields to be deterministic and replay-safe (see "Determinism
guarantees" above) — fields the port's method signatures never receive.

Two ways to close that gap exist, and this task takes neither:

1. **Change the port** to also carry `id`/`createdAt`. Rejected: that
   touches T15's already-shipped, tested, documented contract for a need
   only this task's downstream payload has, and this task's own Section 2
   scope doesn't ask for a port change.
2. **Have the adapter re-derive `id`/`createdAt`** some other way (a fresh
   `IdGenerator`/`Clock`, or a database lookup by `organizationId`+
   `invitationId`+`type`). Rejected: a fresh id/timestamp reintroduces the
   non-determinism this design specifically avoids; a lookup is an extra
   read this task's Section 13 ("keep the adapter pure and durable") gives
   no reason to add.

So instead, this adapter takes a bare `NotificationWorkItem` directly —
which `processNextNotificationWorkItem` already has in hand at the moment
it would otherwise call the port — and is simply not wired into that
processor by this task.

### Not wired into the processor

`processNextNotificationWorkItem` does not call
`deliverNotificationWorkItemAsJsonPayload` today. Wiring the two together
(so every real "delivery" both dispatches through `NotificationDeliveryPort`
*and* persists a payload here) is a composition decision for whichever
future task builds a real provider adapter — at that point, composing
"build+store the payload, then send it" into one step is a concrete,
motivated design, not speculative wiring against an interface with no real
implementation yet. Building that composition now, with no real provider
to make it worth doing, would be the same unused-surface mistake this
sequence's own prior tasks (E05-T13's `requireNonEmptyString`, E05-T15's
original `findById`-less repository) have repeatedly caught and removed.

## Future provider integration (Section 12)

A future task adds a real provider adapter (SendGrid/SES/Postmark/SMTP —
none built here) that:

1. Reads a stored `NotificationDeliveryPayload` (via `findById`, or a
   to-be-designed "unsent payloads" query this task does not build, since
   nothing yet marks a payload as sent/unsent).
2. Maps `template`/`subject`/`variables`/`recipient` onto that provider's
   actual send API.
3. Makes the one real network call this task deliberately never makes.

Because the payload is provider-agnostic and already durable, that future
task is "a thin adapter," exactly as Section 12 states — it does not need
to touch `NotificationWorkItem`, the claim/processing lifecycle (E05-T15),
or this task's builder/schema at all.

## Testing (Section 8)

- **Unit** (`test/application/notification-delivery-payload.test.ts`, 10
  tests): full Section 3 shape, id/createdAt reuse, template mapping for
  all three types, non-empty subjects, `recipient: null` passthrough,
  variable/metadata contents (no internal repository fields), determinism
  (same item → identical JSON twice), and non-collision (different items
  → different JSON).
- **Migration consistency** (2 new tests plus the 5 shared with
  0003/0002's own suites): parses cleanly, every Section 6 column present,
  `CHECK` constraint, RLS statements match the generator byte-for-byte,
  no `DELETE` grant to `tenancy_app`, `tenancy_platform` gets exactly
  `SELECT, INSERT`, FK cascade.
- **Integration**, real Postgres (`test/integration/tenancy-postgres.postgres.test.ts`,
  new `"JSON delivery payload adapter (E05-T16)"` describe block, 8
  tests): durable persistence (stored payload equals
  `buildNotificationDeliveryPayload`'s output, read back via `findById`),
  real-column projection matches Section 6, template mapping for all
  three types end-to-end, variable/metadata mapping end-to-end,
  deterministic JSON end-to-end, **replay safety** (delivering the same
  item twice leaves exactly one row, identical content), and `findById`
  returning `null` for an unstored id.

## A real gap this task's own design process caught before any test ran

The first draft of this task (fresh `IdGenerator`/`Clock` per build, plain
`INSERT`, canonical key-sorting serializer to satisfy "deterministic") was
flagged before being implemented: a builder keyed by a random id cannot be
replay-safe, and no amount of serializer cleverness fixes a builder that
produces different content on every call for the same input. The fix —
reuse the work item's own `id`/`createdAt`, make `store` an idempotent
upsert, drop the serializer entirely — is simpler than the design it
replaced, not just more correct; `JSON.stringify` over a pure builder that
always constructs fields in the same order is already deterministic, with
no extra code needed to make it so.

## Permanent policy reaffirmed (Section 10)

Providers consume stable payloads; payloads are provider-agnostic;
serialization is deterministic; the payload a future provider would send
is durably recorded and attributable to a tenant (every stored payload
carries its `organizationId` and is timestamped — though nothing yet
records that a send actually happened, since no provider exists to send
one); replay uses stored payloads (`findById` plus the idempotent `store`
are exactly that mechanism) — all five describe what this task built.
