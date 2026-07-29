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
