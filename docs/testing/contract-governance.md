# Contract-Suite Governance

- **Effort:** E04 executable-behavioral-contracts work, building on E04-T01
  (`packages/kernel/docs/contract-suite-framework.md`)
- **Companion:** [adapter-certification-matrix.md](adapter-certification-matrix.md)
  tracks every adapter against every suite this document governs.

## Task-numbering note (read this before cross-referencing the blueprint)

`docs/engineering/01-foundation.md` defines **E04-T03** as a single task
with six sub-tasks (.1–.6): EventBus, Cache, RateLimiter, Encrypter,
UnitOfWork, IdempotencyStore. Cache and RateLimiter (.2/.3) already shipped
under E04-T01, proving the framework itself.

A founder directive issued 2026-07-29 renumbered the remaining work as
**T03–T09** (one contract suite per task) and added three ports the
blueprint's E04-T03 sub-list never named: **Logger, ProcessedEventStore,
and Health-check**. Per this project's standing reconciliation-authority
convention (a live, explicit founder instruction resolves a blueprint-label
conflict directly, the same way the E03-T41/T42/T43 label conflict was
resolved), this document and the commits that follow use the founder's
T03–T09 numbering. The mapping, so a future reader isn't left thinking the
blueprint silently drifted:

| Session label | Port(s)             | Blueprint origin                                  |
| ------------- | -------------------- | -------------------------------------------------- |
| T01           | Cache, RateLimiter    | E04-T03.2, E04-T03.3 (shipped ahead, proved the framework) |
| T03           | Logger                | Added by founder directive — not in E04-T03's sub-list |
| T04           | EventBus              | E04-T03.1                                          |
| T05           | UnitOfWork            | E04-T03.5                                          |
| T06           | Encrypter             | E04-T03.4                                          |
| T07           | ProcessedEventStore   | Added by founder directive — not in E04-T03's sub-list |
| T08           | Health-check          | Added by founder directive — not a kernel port at all (see below) |
| T09           | IdempotencyStore      | E04-T03.6                                          |

## How to add a new contract suite

1. **Confirm the port actually has (or will have) more than one
   implementation.** A contract suite's entire value is proving the same
   behavior holds across adapters. If there is exactly one implementation
   and no second is planned, a contract suite is a unit-test suite wearing
   a costume — write a normal test file instead, and record the port as
   **not applicable** in the certification matrix with the reason (see
   Health-check, below).
2. **Scope the suite to what the port's own doc comment makes normative**,
   not to every behavior any one adapter happens to have. Adapter-specific
   extras (a capacity bound, a retry policy, a concurrency-race proof only
   meaningful under real shared storage) stay as adapter-specific tests,
   documented as deliberately excluded in the suite's own file header — see
   `cache-contract.ts`'s treatment of `InMemoryLruCache`'s `maxEntries`
   eviction, or `rate-limiter-contract.ts`'s treatment of Postgres's
   20-concurrent-caller race.
3. **Factories take whatever the adapter genuinely needs to be constructed
   deterministically** — most take `(clock: FixedClock) => T`, because most
   kernel port contracts here are time-sensitive. A port whose contract
   depends on some other injectable (e.g. an event-delivery observer) gets
   a factory shaped for that instead; don't force every suite through an
   identical signature if the port's actual contract doesn't need it.
4. **Never import a test runner as a value.** `SuiteHarness`'s fields are
   typed via `import type` from `vitest` only — this is what keeps
   `@corestack/kernel/testing` at zero added runtime dependencies
   (fitness-test-enforced). Every new suite file follows this.
5. **Write the suite, then convert real test files to use it** — both the
   in-memory adapter's own test file and, if a second (usually Postgres)
   adapter exists, that adapter's integration test file. Converting is the
   proof the suite is right; a suite with nothing converted to it proves
   nothing.
6. **Update the certification matrix** with the new suite's row and every
   adapter's status against it.

## How to certify an adapter

An adapter is **certified** against a contract suite when:

- The suite runs against a real instance of the adapter (not a mock/stub of
  the adapter itself — a real `PostgresRateLimiter` against real
  PostgreSQL, not a fake standing in for it).
- Every assertion in the suite passes.
- For a Postgres-backed adapter, the run is via a direct `vitest run`
  against a real database (local `DATABASE_URL` or Testcontainers) — not
  only unit-level, in-process assertions.

**Partial** means the adapter satisfies some but not all of the suite's
assertions, or satisfies the suite only under a documented adjunct
condition (e.g. a concurrency case that can't be exercised meaningfully
in-process). **Pending** means the suite exists but the adapter hasn't been
run against it yet. **Blocked** means an external constraint (no Docker on
this development machine, per ADR-0018/E04-T02) prevents verification.
**Not applicable** means the pairing doesn't make sense — see Health-check.

## When a contract change is breaking

If tightening or correcting a suite's assertions changes what a
**previously certified** adapter must do to stay certified (as ADR-0022 did
for `Logger`'s redaction/serialization contract), that is a breaking change
to the port's contract, and requires:

- An ADR recording what changed and why (ADR-0022 is the template).
- A check of every existing caller/test that could have depended on the old
  behavior, with the check's result stated in the ADR (ADR-0022: "grepped
  before this change," found none).
- A CHANGELOG entry under the `SECURITY`/breaking-change convention this
  repository already uses.

If a new suite merely covers behavior no adapter violates, it's additive —
no ADR needed (E04-T01's Cache/RateLimiter suites required none).

## Required evidence for behavior changes

Same discipline as every empirical finding in this codebase: if a contract
suite assertion is added because an adapter was found not to satisfy it,
the fix must be verified by observing the assertion **fail** against the
pre-fix adapter before the fix lands, not merely pass after. Where a suite
is testing something no adapter has ever violated, this doesn't apply —
state which case you're in when writing the suite's own report.

## Snapshot-update rules

Snapshot tests (currently: kernel's `api-surface.test.ts` export-diff gate;
platform's future Health JSON-shape snapshots, per T08) exist to force an
explicit, reviewable decision when a public surface changes — not to be
updated reflexively. Before running `vitest -u`:

1. Confirm every new/changed entry in the diff is *intentional* (a real new
   export, not an accidental one from a stray re-export).
2. State in the commit message what changed and why, the same way this
   repository's CHANGELOG entries do.
3. Never update a snapshot to make a test pass without reading the diff —
   the snapshot is the reviewable artifact; skipping the read defeats its
   purpose.

## Concurrency-test requirements

A concurrency assertion belongs in a **shared** contract suite only if it
is meaningful for every certified adapter (e.g. "buckets are independent"
holds identically whether the store is a JS `Map` or a Postgres table). A
concurrency assertion that is only meaningful against real shared storage
(a genuine race between two connections) is an **adapter-specific
adjunct**, not part of the portable suite — see RateLimiter's 20-caller
race, ProcessedEventStore's concurrent-write case. Document the reasoning
in the suite file's header comment, not just in this doc, so a reader of
the suite alone understands the scope without cross-referencing.

---

## Suite-by-suite log

### Logger (T03) — 2026-07-29

**Found:** neither shipped `Logger` adapter (`CaptureLogger`, `NoopLogger`)
performed the runtime redaction the port doc already claimed was mandatory,
and `CaptureLogger` silently serialized any `Error` field value to `{}`
(`Error.prototype.message`/`.stack` are non-enumerable, so a plain spread
loses them). Founder confirmed runtime redaction should be normative
(defense-in-depth behind the static eslint deny-list) when this fork was
surfaced — see ADR-0022. Fixed both, added `defineLoggerContractSuite`,
converted kernel's own `ports.test.ts` to run it against both adapters.
Kernel: 81 → 97 tests. No Postgres `Logger` adapter exists (the future pino
adapter isn't built) — matrix row is `pending` for that column, not
`blocked` or `n/a`, since it's planned, just not yet built.

### EventBus (T04) — 2026-07-29

Scoped to exactly what `event-bus.ts`'s doc comment makes normative:
sequential in-subscription-order delivery (both single-event and batch),
wildcard matching, version filtering, every-handler-attempted with
aggregated failures, unsubscribe, and that a published event reaches its
handler with every envelope field unchanged. Added one clarifying test —
`publish()` has no built-in deduplication, republishing the same event
redelivers it — to make explicit why `idempotentHandler`/
`ProcessedEventStore` exist, rather than letting "idempotent publication"
(requested in the founder directive) read as a claim `EventBus` itself
doesn't and shouldn't make.

No Postgres `EventBus` exists, and none is planned — the outbox relay is a
deliberately separate async/checkpointed mechanism (ADR-0009), not a second
`EventBus` implementation. Matrix row: **not applicable**, not `pending`.

Per Section 5's request for "a failing adapter fixture that violates
delivery order": added `ReverseOrderEventBus` in `event-bus.test.ts` — a
fixture that delivers subscriptions in reverse order. It is **not** run
through `defineEventBusContractSuite` (that would register a
permanently-failing test in CI); instead one targeted assertion proves the
fixture actually produces the wrong order, demonstrating the shared suite's
ordering assertion has real teeth without shipping a red test.

### UnitOfWork (T05) — 2026-07-29

Scoped to exactly what the port doc makes normative across **both**
adapters: `run()` returns the work callback's result, staged events are
dispatched only after commit and in stage order, and staged events (plus
any other writes) are discarded entirely when `work` throws.

**Found and documented, not fixed:** the port doc's "nesting is not
supported" clause is only mechanically enforced by `PostgresUnitOfWork`
(via `TransactionSql` having no `.begin()` — a real shared connection to
protect). `InMemoryUnitOfWork` has no equivalent shared resource, so nested
calls cause no corruption there and aren't separately enforced — no
existing test ever claimed otherwise for the in-memory adapter. Unlike the
Logger redaction gap, this isn't a defect: manufacturing a same-instance
reentrancy guard on the in-memory adapter would catch only same-instance
nesting (not the general pattern the doc warns about), for no real safety
payoff, the same "a rule with no real teeth is worse than no rule"
reasoning as ADR-0021's downgraded fitness rules. Clarified in
`unit-of-work.ts`'s doc comment; nesting-rejection stays a
`PostgresUnitOfWork`-specific integration test.

**The highest-value result in this suite:** `drainDispatched()` for
`PostgresUnitOfWork` runs a real `OutboxRelay.pollOnce()` against a real
`PostgresOutboxRelayStore`, proving the full `UnitOfWork` → `platform.outbox`
→ relay pipeline end-to-end for the first time in this codebase — every
prior test proved each stage in isolation. Kernel: 101 → 103 tests.
Platform integration: unchanged count after removing one now-duplicate
test and adding three shared-suite tests (net swap, not additive) —
91 → 93 once the shared suite's three tests are counted alongside the six
remaining Postgres-specific ones.

### Encrypter (T06) — 2026-07-29

Only one implementation exists (`WebCryptoAesGcmEncrypter`); the port doc
names a future KMS-backed adapter as a planned extension, not yet built —
matrix row is `pending` for that column, the same status as `Logger`'s
planned pino adapter, not `n/a`. The factory mirrors
`WebCryptoAesGcmEncrypter.create`'s real construction shape (a raw key set
plus which id is current) rather than a bare `() => T`, because the
rotation assertion inherently needs two related instances built over
overlapping key sets.

Covers round-trip correctness, current-key-id tagging, rotation (an older
key id still decrypts, new encryptions use the new id), tamper detection,
unknown-key-id rejection, and — new, not previously asserted — that
**neither failure path's error message ever contains the plaintext**, and
that **two encryptions of the same plaintext produce different IVs and
different ciphertexts** (GCM's randomized-IV requirement, previously
implied by "12-byte IV" but never checked for actual per-call uniqueness).
Kept adapter-specific: the exact 12-byte IV length, and construction-time
rejection of a wrong-length key or an absent `currentKeyId` (both about
`WebCryptoAesGcmEncrypter`'s own `create()` validation, not the `Encrypter`
interface's `encrypt`/`decrypt` contract). Kernel: 103 → 107 tests.

### ProcessedEventStore (T07) — 2026-07-29

Covers `hasProcessed`/`markProcessed` basic contract, idempotent marking,
consumer- and event-id scope isolation, and — via `idempotentHandler` —
exactly-once-per-redelivery plus at-least-once retry on failure (the
existing kernel/Postgres tests these replaced, relocated and consolidated,
not duplicated). Kept adapter-specific: genuine concurrent-write races
(added as a Postgres adjunct, 10 concurrent `markProcessed` calls on the
same pair, same reasoning as `RateLimiter`'s 20-caller test) and
same-transaction atomicity with a handler's own state change (a
caller-composition concern the generic `idempotentHandler` wrapper can't
provide by itself — see `PostgresProcessedEventStore`'s own doc comment).
"Cleanup safety" (requested in the founder directive) doesn't apply to
this port at all — it has no cleanup/prune method; retention of old
`platform.processed_events` rows is `maintainOutboxPartitions`'s concern,
already tested there.

**Real bug caught by the suite itself, before it shipped:** the first
version used readable literal ids (`"evt-1"`, `"evt-2"`) — passed against
kernel's in-memory adapter, then failed all 6 shared-suite tests against
`PostgresProcessedEventStore` with `invalid input syntax for type uuid:
"evt-1"` the instant it ran against real Postgres (`platform.processed_
events.event_id` is a `uuid` column). Fixed by switching to real UUID
literals — the same "UUID vs readable-id" gotcha already documented
elsewhere in this codebase's integration tests, now also documented here
as a reminder for any future suite with a similarly-typed column. Kernel:
107 → 110 tests. Platform integration: 93 → 95.

### Health-check (T08) — 2026-07-29

Not a contract suite — deliberately. `checkLiveness`/`checkReadiness` are
plain functions taking dependencies as parameters (`ReadinessDeps`), not a
port with a swappable implementation set; there is nothing for a
contract-suite factory to construct, and forcing one here would be a unit
test wearing a costume (see "How to add a new contract suite," item 1,
above). Per the founder directive's own fallback request ("snapshot-test
the public payloads"), added 3 `toMatchSnapshot()` tests in
`health-readiness.test.ts` pinning the exact JSON shape for `checkLiveness`,
a minimal `checkReadiness` (no optional checks configured), and a fully-
configured one (relay lag, backlog, and module health all present). Every
existing test in that file already asserts individual field values in
depth — these three exist purely to catch an accidental shape change
(an added/removed/renamed field) that per-field assertions could miss.
Recorded in the certification matrix as **not applicable**, not
`pending`/`blocked` — there is no missing adapter to build here. Platform
unit: 19 → 22.

### IdempotencyStore (T09) — 2026-07-29

The cleanest suite in this batch: every existing kernel test (10, including
the ADR-0020 cross-tenant SECURITY regression) was already pure begin/
complete state-machine logic against a clock-injectable adapter, so the
entire block relocated into the shared suite verbatim — no scope
narrowing needed, unlike every other port in this effort. Both adapters
accept a `Clock` constructor option, so the factory follows the same
`(clock: FixedClock) => T` shape as `Cache`/`RateLimiter`.

Kept adapter-specific: the blueprint's own 2-connection concurrency
acceptance criterion and a 20-concurrent-caller race (both meaningful only
against real shared storage, the `Map`-backed in-memory adapter can't
race with itself). `pruneIdempotencyKeys`'s own test (unrelated to the
port's `begin`/`complete` contract) was untouched.

Kernel: 110 tests (net zero change — a pure relocation, not new coverage).
Platform integration: 95 → 96 (net +1 after removing 9 duplicated tests
and adding 10 shared-suite tests).

**All seven contract suites from the founder's T03–T09 directive are now
complete.** See the certification matrix for the full per-port status.

## Fitness rules (Section 13)

`packages/architecture-tests/test/contract-suite-adapter-matrix.test.mjs`
implements the one of the three requested rules that's mechanically
checkable: **every class implementing a kernel port must appear in
`docs/testing/adapter-certification-matrix.md`.** Text-based, matching
`class X implements <PortName>` — the same style as every other rule in
that package — and proven against both the real repository (13 adapters
found, all already present) and synthetic violating/passing fixtures.
Verified to have real teeth: temporarily renamed `InMemoryLruCache` to a
placeholder in the matrix, confirmed the test failed with exactly the
expected violation message, restored it.

**Not implemented, same triage as ADR-0021's rules 4/5:**

- **"No adapter may bypass its contract suite."** Detecting whether a
  specific test file *calls* the relevant `define*ContractSuite` function
  (versus containing hand-written tests that happen to cover similar
  ground) requires parsing call expressions and cross-referencing which
  suite corresponds to which port — this package's regex/text scanner has
  no notion of "this test file is for adapter X, which implements port Y,
  which has suite Z." A text-pattern approximation risks the exact
  false-confidence failure mode ADR-0021 warns against: silently passing
  on a renamed import or an indirection.
- **"No duplicated behavioural test blocks once a shared suite exists."**
  Requires semantic comparison of test bodies (does this `it()` assert the
  same thing the shared suite already does?) — categorically beyond a
  text scanner. This is why every conversion in this effort was done by a
  human (well, by the agent doing this work) reading both the old test
  file and the new suite side by side and deciding what to remove, not by
  a mechanical check.

Both stay reviewed-convention items, stated here so a future contributor
knows the check was considered and deliberately not automated, not
overlooked.
