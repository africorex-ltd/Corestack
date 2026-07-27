# Engineering Blueprint — M3: Revenue & Delivery

Epics E09–E13. Standards: [00-OVERVIEW.md](00-OVERVIEW.md). Jobs (E11) leads
inside M3 — notifications, webhooks, and billing reconciliation all consume the
queue. Design sources: Architecture §13–15, §21–22; DB §7, §9–12; API §8–10, §16.

---

## E09 — Billing Module `@corestack/billing` (M3, 34 tasks, ~52d)

**Goal:** plans, subscription state machine, entitlements read model, Stripe
reference adapter, webhook-hint/API-truth reconciliation.

### F9.1 Domain

| ID      | Task — Description                                                                                                             | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | --- | --- | ------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| E09-T01 | Module scaffold from template                                                                                                  | INF | P0  | E05-T29 | S/1d   | Boots; lint green                                                                                                                       |
| E09-T02 | Plan model — code-defined catalog, versioning/grandfathering semantics, entitlement spec shape (DB §7)                         | DOM | P0  | T01     | M/2d   | Plan-version immutability invariant; spec validation                                                                                    |
| E09-T03 | `Subscription` aggregate — full state machine (incomplete/trialing/active/past_due/canceled/unpaid), period bookkeeping, seats | DOM | P0  | T02     | L/3d   | Every transition legal-listed; illegal → ConflictError; property test: no unreachable states. Sub: .1 states; .2 period math; .3 events |
| E09-T04 | Entitlement model — derived read-model semantics, override precedence (`source='override'` survives reconcile)                 | DOM | P0  | T02     | M/2d   | Rebuild determinism property test: same sub state + spec ⇒ same entitlements                                                            |
| E09-T05 | Money VO — minor units + currency, arithmetic guards (DB rule 8)                                                               | DOM | P0  | T01     | S/1d   | Mixed-currency operation → error; property tests                                                                                        |

### F9.2 Application — Subscription Lifecycle

| ID      | Task — Description                                                                                                                   | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | --- | --- | ------------ | ------ | ----------------------------------------------------------------------------------------------------------------- |
| E09-T06 | Ports — CustomerRepo, SubscriptionRepo, EntitlementRepo, ProviderEventRepo, `PaymentGateway` (vendor-neutral verbs, Architecture §3) | APP | P0  | T03          | M/2d   | Gateway port reviewed against 2 providers' shapes (Stripe + one paper-fit: Paddle) to avoid Stripe-shaped leakage |
| E09-T07 | `StartCheckout` — customer ensure + provider checkout session; **Idempotency-Key required**                                          | APP | P0  | T06          | M/2d   | Duplicate key replays (E03-T43); live-subscription conflict → 409                                                 |
| E09-T08 | `ChangeSubscription` — plan/seat change with `?preview` dry-run proration (API §8)                                                   | APP | P0  | T07          | M/2d   | Preview commits nothing (verified); change reconciles via T12                                                     |
| E09-T09 | `CancelSubscription` — period-end default, immediate explicit, step-up                                                               | APP | P0  | T07          | S/1d   | State machine transitions exact; events                                                                           |
| E09-T10 | `GetSubscription` / `GetPortalSession`                                                                                               | APP | P0  | T06          | S/1d   | `{status:"none"}` shape for never-subscribed (API §8)                                                             |
| E09-T11 | Billing purge handler + org-deletion interaction — cancel-at-provider on org purge                                                   | APP | P1  | T09, E03-T33 | S/1d   | Provider-side cancel idempotent                                                                                   |

### F9.3 Application — Reconciliation Engine

| ID      | Task — Description                                                                                                                                      | Cat | Pri | Deps          | Cx/Est | Acceptance criteria & subtasks                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E09-T12 | Reconciliation core — webhook-as-hint: fetch provider truth, diff, transition local state (Architecture §21)                                            | APP | P0  | T03, T06      | L/4d   | Out-of-order/duplicate/stale hints converge to provider truth (scenario table ≥ 10 cases). Sub: .1 fetch+diff; .2 transition application; .3 convergence scenarios |
| E09-T13 | Webhook ingestion use case — signature verify, dedupe (provider event UK), enqueue reconcile job, fast 2xx                                              | APP | P0  | T12, E11 port | M/2d   | Replay harmless; unverifiable signature → 400 no processing                                                                                                        |
| E09-T14 | Entitlement rebuild — transactional rebuild on state change + version bump + `entitlement.changed` event                                                | APP | P0  | T04, T12      | M/2d   | Atomic with subscription tx (crash suite); overrides preserved                                                                                                     |
| E09-T15 | `CheckEntitlement` / `GetEntitlements` — the hot read: version-cached, fail-open-on-limits/fail-closed-on-new-activation degradation (Architecture §21) | APP | P0  | T14, E02-T07  | M/2d   | Degradation behavior configurable + tested under induced provider outage                                                                                           |
| E09-T16 | Entitlement gate helper — `requiresEntitlement(key)` guard for use cases (consumed by rbac custom-roles E07-T13 etc.)                                   | APP | P0  | T15           | S/1d   | Retrofit checklist to existing gated features                                                                                                                      |
| E09-T17 | Admin entitlement override use case — support gesture path, audited (API §14)                                                                           | APP | P1  | T14           | S/1d   | Override survives next reconcile (tested)                                                                                                                          |
| E09-T18 | Trial + past-due policies — trial expiry job, dunning-state entitlement degradation schedule                                                            | APP | P1  | T14, E11      | M/2d   | Policy table documented + tested transitions                                                                                                                       |

### F9.4 Stripe Reference Adapter

| ID      | Task — Description                                                                                              | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| E09-T19 | Stripe gateway adapter — checkout/subscription/portal/customer ops against `PaymentGateway` port                | ADP | P0  | T06     | L/4d   | Gateway contract suite green vs stripe-mock + recorded live fixtures. Sub: .1 customer+checkout; .2 subscription ops; .3 portal |
| E09-T20 | Stripe webhook verification adapter — signature scheme, timestamp window, event parsing                         | ADP | P0  | T13     | M/2d   | Official test vectors pass; tampered/stale rejected                                                                             |
| E09-T21 | Stripe mapping table — plan/price refs, status mapping (provider states → state machine), documented            | ADP | P0  | T19     | M/2d   | Every Stripe subscription status has an explicit mapping or explicit rejection                                                  |
| E09-T22 | Stripe sandbox E2E — checkout→webhook→reconcile→entitlement golden path against Stripe test mode (nightly lane) | TST | P1  | T19–T21 | M/2d   | Nightly green; failures page owners                                                                                             |

### F9.5 Postgres Adapter & Interface

| ID      | Task — Description                                                                                    | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E09-T23 | Billing schema migrations — DB §7 tables incl. live-subscription PUX, provider_events partitioned     | ADP | P0  | T06          | M/2d   | UK dedupe verified under concurrent insert                                                                                                                 |
| E09-T24 | Repositories — customer/subscription/entitlement/provider-event                                       | ADP | P0  | T23          | L/3d   | Contract suites green. Sub: .1 customer+subscription; .2 entitlements+versions; .3 provider events                                                         |
| E09-T25 | Billing endpoints — API §8 set (checkout, change+preview, cancel, portal, entitlements, public plans) | API | P0  | T07–T15, E14 | L/3d   | Idempotency-Key required-path tested; plans endpoint unauthenticated tier limits. Sub: .1 subscription ops; .2 entitlements+plans; .3 webhook ingest route |
| E09-T26 | Isolation + authz wiring                                                                              | SEC | P0  | T24          | M/2d   | Gating; includes webhook-ingest spoof scenarios                                                                                                            |

### F9.6 Completion

| ID      | Task — Description                                                                                                             | Cat | Pri | Deps     | Cx/Est  | Acceptance criteria & subtasks                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | --- | --- | -------- | ------- | ----------------------------------------------------------- |
| E09-T27 | Money-path crash consistency — kill-mid-reconcile / mid-entitlement-rebuild scenarios (E03-T13 pattern)                        | SEC | P0  | T14      | M/2d    | No double-charge-adjacent states; convergence after restart |
| E09-T28 | Billing threat model — webhook forgery, replay, entitlement tampering, IDOR on billing objects                                 | SEC | P0  | T27      | M/2d    | Module gate                                                 |
| E09-T29 | Billing docs — integration guide (Stripe setup→plans→gating features), degradation-policy guide, provider-port authoring guide | DOC | P0  | T25      | L/3d    | Naive-reader test: Stripe test-mode to gated feature < 2 h  |
| E09-T30 | Billing `/testing` subpath — gateway fake with scenario scripting (decline, dunning), entitlement fixtures                     | TST | P1  | T24      | M/2d    | Fake passes gateway contract suite                          |
| E09-T31 | Billing 0.1 release                                                                                                            | REL | P0  | all      | XS/0.5d | Published                                                   |
| E09-T32 | Usage-metering design note — post-1.0 port sketch reserved (Architecture §21), non-blocking                                    | DOC | P3  | T04      | S/1d    | Design note filed as RFC draft                              |
| E09-T33 | Paddle adapter feasibility spike — validate gateway port against second real provider (timeboxed)                              | ADP | P3  | T19      | M/2d    | Findings doc; port changes (if any) before 1.0 freeze       |
| E09-T34 | Dunning notification pack — past-due/payment-failed templates via notifications module                                         | APP | P2  | T18, E10 | S/1d    | Templates registered; preferences category `billing`        |

---

## E10 — Notifications Module `@corestack/notifications` (M3, 20 tasks, ~28d)

**Goal:** templated multi-channel delivery behind ports, preference-enforced,
job-driven (Architecture §15).

### F10.1 Domain & Application

| ID      | Task — Description                                                                                                          | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| E10-T01 | Module scaffold from template                                                                                               | INF | P0  | E05-T29      | S/1d   | Boots; lint green                                                                                                              |
| E10-T02 | Template registry — code-adjacent typed templates (Zod variables), versioned, category-tagged (DB §9)                       | DOM | P0  | T01          | M/2d   | Unknown variable at render → boot-time error, not send-time                                                                    |
| E10-T03 | Preference model — category × channel matrix, org overrides, `security` non-optoutable rule                                 | DOM | P0  | T01          | S/1d   | Policy unit-tested incl. immutable category                                                                                    |
| E10-T04 | Ports — `MailSender`, `InAppInbox`, DeliveryRepo, PreferenceRepo                                                            | APP | P0  | T02          | S/1d   | Contract suites declared                                                                                                       |
| E10-T05 | `SendNotification` — the single dispatch path: template render, preference check, channel fan-out, job enqueue per delivery | APP | P0  | T02–T04, E11 | L/3d   | Suppression recorded (not silent); render failures dead-letter with alert metric. Sub: .1 dispatch; .2 suppression; .3 fan-out |
| E10-T06 | Event-driven sends — subscription mapping (invitation→email, security events→forced email) registered by modules            | APP | P0  | T05, E03-T12 | M/2d   | Raw invitation token flows only through this path (E05-T17 contract); idempotent per event                                     |
| E10-T07 | Inbox use cases — list/unread-count/read/read-all/archive                                                                   | APP | P0  | T04          | M/2d   | Badge query cheap (index check)                                                                                                |
| E10-T08 | Preference use cases — get/put matrix with security-category rejection                                                      | APP | P0  | T03          | S/1d   | 422 on immutable-category attempt                                                                                              |
| E10-T09 | Delivery-log query — org-scoped support surface (masked recipients, API §9)                                                 | APP | P1  | T05          | S/1d   | Masking verified in DTO snapshot                                                                                               |

### F10.2 Adapters

| ID      | Task — Description                                                                  | Cat | Pri | Deps | Cx/Est | Acceptance criteria & subtasks                                    |
| ------- | ----------------------------------------------------------------------------------- | --- | --- | ---- | ------ | ----------------------------------------------------------------- |
| E10-T10 | Notifications schema migrations — DB §9 tables, deliveries partitioned              | ADP | P0  | T04  | M/2d   | Masked-recipient column only (no raw address at rest, verified)   |
| E10-T11 | Repositories — preference/delivery/inbox                                            | ADP | P0  | T10  | M/2d   | Contract suites green                                             |
| E10-T12 | SMTP adapter — `MailSender` reference #1                                            | ADP | P0  | T04  | M/2d   | Contract suite vs mailcatcher container; TLS required by default  |
| E10-T13 | Resend adapter — `MailSender` reference #2 (API-provider end of market)             | ADP | P1  | T12  | S/1d   | Same contract suite green — proving the port from both ends       |
| E10-T14 | Email rendering pipeline — layout + text/html alternative parts, link-domain policy | ADP | P1  | T02  | M/2d   | Rendered snapshots reviewed; no tracking pixels (privacy posture) |

### F10.3 Interface & Completion

| ID      | Task — Description                                                                                   | Cat | Pri | Deps         | Cx/Est  | Acceptance criteria & subtasks                                  |
| ------- | ---------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------- | --------------------------------------------------------------- |
| E10-T15 | Notification endpoints — API §9 set (inbox, preferences, delivery log)                               | API | P0  | T07–T09, E14 | M/2d    | No raw-send endpoint exists (verified absent — API §9 decision) |
| E10-T16 | Isolation + authz wiring                                                                             | SEC | P0  | T11          | S/1d    | Gating                                                          |
| E10-T17 | Abuse review — template injection, header injection, open-redirect in links, unsubscribe correctness | SEC | P0  | T14          | M/2d    | Scenario tests fail closed                                      |
| E10-T18 | Notifications docs — template authoring guide, channel adapter guide, preference UX guide            | DOC | P0  | T15          | M/2d    | Template guide with 2 worked examples                           |
| E10-T19 | `/testing` subpath — capturing mail fake + template assertion helpers                                | TST | P1  | T11          | S/1d    | Used by E05/E06 flows' tests                                    |
| E10-T20 | Notifications 0.1 release                                                                            | REL | P0  | all          | XS/0.5d | Published                                                       |

---

## E11 — Jobs Module `@corestack/jobs` (M3-lead, 22 tasks, ~34d)

**Goal:** queue-agnostic background work: Postgres SKIP LOCKED reference,
transactional enqueue, schedules, worker runtime. **First in M3** (others
consume it).

### F11.1 Core

| ID      | Task — Description                                                                                                     | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| E11-T01 | Module scaffold from template                                                                                          | INF | P0  | E05-T29      | S/1d   | Boots; lint green                                                                                                                              |
| E11-T02 | Job model — definition registry (typed payloads via Zod), retry/backoff policy VO, priority, status machine            | DOM | P0  | T01          | M/2d   | Unregistered job name at enqueue → error; backoff math property-tested                                                                         |
| E11-T03 | `JobQueue` port — enqueue (tx-aware), schedule, claim/complete/fail semantics spec (visibility timeout, at-least-once) | APP | P0  | T02          | M/2d   | Semantics doc is the contract-suite source; port vendor-neutral                                                                                |
| E11-T04 | `EnqueueJob` + transactional enqueue — same-UoW commit/rollback (Architecture §14)                                     | APP | P0  | T03, E02-T10 | M/2d   | Rollback discards job (tested); Context propagation into payload envelope                                                                      |
| E11-T05 | Worker runtime — claim loop, handler dispatch with Context, heartbeat, graceful drain (E03-T24 integration)            | APP | P0  | T03          | L/4d   | Handler crash → retry per policy; drain completes in-flight within bound. Sub: .1 claim loop; .2 dispatch+ctx; .3 drain; .4 stalled-job reaper |
| E11-T06 | Retry/dead-letter engine — attempts, backoff+jitter, dead status + `job.failed` event                                  | APP | P0  | T05          | M/2d   | Dead-letter emits event (notifications/alerting consume); max-attempts boundary tested                                                         |
| E11-T07 | Scheduler — cron evaluation (tz-aware), SKIP LOCKED claim, catch-up policy (skip vs fire-once on downtime)             | APP | P0  | T03          | L/3d   | No double-fire with 3 concurrent schedulers (race test); DST transitions tested. Sub: .1 cron eval; .2 claim; .3 catch-up policy               |

### F11.2 Adapters

| ID      | Task — Description                                                                         | Cat | Pri | Deps | Cx/Est | Acceptance criteria & subtasks                                                     |
| ------- | ------------------------------------------------------------------------------------------ | --- | --- | ---- | ------ | ---------------------------------------------------------------------------------- |
| E11-T08 | Jobs schema migrations — hot table + history partition + schedules (DB §10)                | ADP | P0  | T03  | M/2d   | Fetch-next index matches worker query exactly (explain-plan gate)                  |
| E11-T09 | Postgres queue adapter — SKIP LOCKED implementation of the port                            | ADP | P0  | T08  | L/3d   | Full queue contract suite green; throughput baseline recorded (benchmark)          |
| E11-T10 | History sweeper — terminal jobs → history partitions; hot-table size bound                 | ADP | P0  | T09  | S/1d   | Sweep under load keeps hot table < threshold (test)                                |
| E11-T11 | BullMQ/Redis adapter — second reference proving the port (Architecture §14)                | ADP | P1  | T09  | L/3d   | Same contract suite green vs Redis container — behavioral equivalence demonstrated |
| E11-T12 | Queue metrics — depth/age/failure-rate OTel instruments (golden signals, Architecture §31) | ADP | P1  | T09  | S/1d   | Metrics visible in fixture harness                                                 |

### F11.3 Interface & Completion

| ID      | Task — Description                                                                                         | Cat | Pri | Deps     | Cx/Est  | Acceptance criteria & subtasks                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------- | --- | --- | -------- | ------- | ------------------------------------------------------------------------------------ |
| E11-T13 | Worker process role — entrypoint flag, role-scoped composition (web vs worker, Architecture §2)            | APP | P0  | T05      | M/2d    | Same image both roles; worker skips HTTP binding                                     |
| E11-T14 | Operational endpoints — dead-letter review/redeliver under admin permission (internal tier)                | API | P2  | T06, E14 | S/1d    | `admin:jobs.manage`; audited                                                         |
| E11-T15 | Crash-consistency for queue — kill-mid-claim/mid-complete scenarios                                        | SEC | P0  | T09      | M/2d    | No lost jobs, no double-completion effects (with idempotent handler contract stated) |
| E11-T16 | Jobs threat model — payload injection, queue poisoning, timing/starvation                                  | SEC | P0  | T15      | S/1d    | Module gate                                                                          |
| E11-T17 | Jobs docs — handler authoring, idempotency requirements, scheduling guide, scaling (worker fleet) runbook  | DOC | P0  | T13      | M/2d    | Handler guide includes the at-least-once warning prominently                         |
| E11-T18 | `/testing` subpath — inline synchronous queue fake for application tests                                   | TST | P0  | T09      | S/1d    | Fake passes contract suite (minus timing clauses, flagged)                           |
| E11-T19 | Jobs 0.1 release                                                                                           | REL | P0  | all      | XS/0.5d | Published — unblocks E09/E10/E12 consumers                                           |
| E11-T20 | Load benchmark — sustained throughput profile pg vs BullMQ published (Architecture §14 threshold guidance) | TST | P2  | T11      | M/2d    | Numbers in docs; guidance thresholds validated                                       |
| E11-T21 | Job Context propagation audit — correlation ids flow enqueue→handler→emitted events (Architecture §32)     | TST | P1  | T05      | S/1d    | Single-id trace across boundary proven in test                                       |
| E11-T22 | Stalled-worker chaos test — worker kill under load, visibility-timeout recovery                            | SEC | P1  | T15      | S/1d    | Recovery within timeout bound; no orphaned running rows                              |

---

## E12 — Webhooks Module `@corestack/webhooks` (M3, 20 tasks, ~30d)

**Goal:** signed outbound delivery of platform events with retries, rotation,
and a real debugging surface (Architecture §6; API §16).

### F12.1 Domain & Application

| ID      | Task — Description                                                                                                                                        | Cat | Pri | Deps                  | Cx/Est | Acceptance criteria & subtasks                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E12-T01 | Module scaffold from template                                                                                                                             | INF | P0  | E05-T29               | S/1d   | Boots; lint green                                                                                                                                                   |
| E12-T02 | Endpoint aggregate — URL policy (https, SSRF filter), event subscriptions, secret lifecycle (encrypted, dual-sign rotation), failure counter/auto-disable | DOM | P0  | T01                   | M/2d   | SSRF: private ranges/localhost/link-local rejected incl. DNS-rebind note; rotation window semantics                                                                 |
| E12-T03 | Signature scheme — `t=…,v1=…` HMAC-SHA256, multi-secret signing, 5-min tolerance (API §16)                                                                | DOM | P0  | T02                   | M/2d   | Test vectors published (docs consume them); constant-time compare                                                                                                   |
| E12-T04 | Endpoint CRUD use cases — create (secret one-render), update/pause, delete, rotate-secret (step-up)                                                       | APP | P0  | T02                   | M/2d   | Event-name validation against registry; rotation dual-window tested                                                                                                 |
| E12-T05 | Delivery pipeline — outbox consumer → subscription match → delivery job per endpoint (via E11), envelope build                                            | APP | P0  | T03, E03-T12, E11-T19 | L/3d   | At-least-once with delivery-id dedupe key; org-scoped events only to that org's endpoints (isolation-critical). Sub: .1 consumer+match; .2 job handler; .3 envelope |
| E12-T06 | Retry/disable policy — backoff ≤ 24 h, consecutive-failure auto-disable + notification (DB §11)                                                           | APP | P0  | T05                   | M/2d   | Policy boundaries tested; re-enable resets counter                                                                                                                  |
| E12-T07 | `TestEndpoint` (ping) + `Redeliver` use cases                                                                                                             | APP | P1  | T05                   | S/1d   | Ping signed identically to real events                                                                                                                              |
| E12-T08 | Delivery-log query — attempt history per endpoint                                                                                                         | APP | P0  | T05                   | S/1d   | Response snippet capped 1 KB (DB §11)                                                                                                                               |

### F12.2 Adapters & Interface

| ID      | Task — Description                                                                                                               | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                           |
| ------- | -------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | ---------------------------------------------------------------------------------------- |
| E12-T09 | Webhooks schema migrations — endpoints + partitioned deliveries (DB §11)                                                         | ADP | P0  | T02          | S/1d   | RLS; UK dedupe verified                                                                  |
| E12-T10 | Repositories                                                                                                                     | ADP | P0  | T09          | M/2d   | Contract suites green                                                                    |
| E12-T11 | HTTP delivery adapter — egress client: timeouts, no-redirect-follow, response capture, IP re-validation at connect (SSRF TOCTOU) | ADP | P0  | T05          | M/2d   | Redirect not followed (tested); connect-time IP check against resolved-at-validation set |
| E12-T12 | Webhook endpoints — API §16 management set                                                                                       | API | P0  | T04–T08, E14 | M/2d   | Secret one-render; permission tags; rotation step-up                                     |
| E12-T13 | Isolation + authz wiring — incl. cross-org event-leak scenario (an org's endpoint must never receive another org's events)       | SEC | P0  | T10, T05     | M/2d   | Leak scenario in isolation suite permanently                                             |

### F12.3 Completion

| ID      | Task — Description                                                                                                                        | Cat | Pri | Deps | Cx/Est  | Acceptance criteria & subtasks                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ---- | ------- | ---------------------------------------------------------- |
| E12-T14 | Receiver verification kit — consumer-side signature verify helper published (in `@corestack/client` scope later) + docs with test vectors | TST | P0  | T03  | M/2d    | Helper passes vectors; docs walk a receiver implementation |
| E12-T15 | Webhook threat model — SSRF, replay, secret exfiltration, delivery-log poisoning                                                          | SEC | P0  | T13  | M/2d    | Module gate                                                |
| E12-T16 | Fuzz signatures + envelope parsing (E04-T15 rig)                                                                                          | SEC | P1  | T03  | S/1d    | Corpus in nightly lane                                     |
| E12-T17 | Webhooks docs — adopter guide (registering, verifying, dedupe discipline), event catalog auto-generated from registries                   | DOC | P0  | T14  | M/2d    | Event catalog generation wired to CI                       |
| E12-T18 | `/testing` subpath — capturing delivery fake + signature assertion helpers                                                                | TST | P1  | T10  | S/1d    | Contract-tested                                            |
| E12-T19 | Webhooks 0.1 release                                                                                                                      | REL | P0  | all  | XS/0.5d | Published                                                  |
| E12-T20 | Delivery-rate metrics + failure alerting hooks (golden signals)                                                                           | ADP | P1  | T05  | S/1d    | Failure-rate metric visible; alert doc                     |

---

## E13 — Storage `@corestack/storage` (M3, 14 tasks, ~20d)

**Goal:** `FileStorage` port + metadata registry + signed-URL handshake
(Architecture §22; DB §12; API §10).

| ID      | Task — Description                                                                                                         | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | ------------------------------------------------------------------------------------------------------------- |
| E13-T01 | Module scaffold from template                                                                                              | INF | P0  | E05-T29      | S/1d   | Boots; lint green                                                                                             |
| E13-T02 | `FileStorage` port — put/get/delete/signed-URL (up+down), streaming semantics, content-type allowlist hook                 | APP | P0  | T01          | M/2d   | Port spec = contract-suite source; provider-neutral                                                           |
| E13-T03 | Object model — derived object keys (never user-controlled, DB §12), status lifecycle (pending→available→deleted), checksum | DOM | P0  | T01          | S/1d   | Path-traversal impossible by construction (key derivation test)                                               |
| E13-T04 | Upload handshake use cases — initiate (policy-validate first), complete (checksum/size verify), abort                      | APP | P0  | T02, T03     | M/2d   | Signed URL only after policy pass; orphan-pending sweeper job                                                 |
| E13-T05 | Read/delete use cases — metadata get, download-URL issue (short TTL), soft-delete→purge                                    | APP | P0  | T04          | M/2d   | Bytes outlive metadata never (purge order test, DB §12)                                                       |
| E13-T06 | List use case — org-scoped, filters contentType/uploadedBy                                                                 | APP | P1  | T05          | S/1d   | Cursor pagination                                                                                             |
| E13-T07 | Storage schema migration — objects table per DB §12, RLS                                                                   | ADP | P0  | T03          | S/1d   | UK (bucket,key)                                                                                               |
| E13-T08 | S3-compatible adapter — one adapter covering AWS/R2/MinIO (Architecture §22)                                               | ADP | P0  | T02          | L/3d   | Contract suite green vs MinIO container; presign both directions. Sub: .1 ops; .2 presign; .3 checksum verify |
| E13-T09 | Local-filesystem adapter — dev-only, loud non-production warning                                                           | ADP | P1  | T02          | S/1d   | Contract suite green (minus presign clauses, flagged); refuses to boot with NODE_ENV=production               |
| E13-T10 | Storage endpoints — API §10 handshake set                                                                                  | API | P0  | T04–T06, E14 | M/2d   | 302-vs-JSON content negotiation on download                                                                   |
| E13-T11 | Isolation + authz wiring                                                                                                   | SEC | P0  | T07          | S/1d   | Gating                                                                                                        |
| E13-T12 | Storage threat model — content-type smuggling, presign leakage/replay, quota abuse                                         | SEC | P0  | T11          | S/1d   | Module gate; upload size/type limits enforced pre-sign                                                        |
| E13-T13 | Storage docs + `/testing` fake                                                                                             | DOC | P0  | T10          | M/2d   | Adopter guide: attachments end-to-end; in-memory fake contract-tested                                         |
| E13-T14 | Storage 0.1 release + M3 exit review                                                                                       | REL | P0  | all E09–E13  | S/1d   | M3 exit criteria all check (Overview §6)                                                                      |
