# Component Spec — Contract-Suite Framework

- **Task:** E04-T01 · **Status:** Implemented (Cache, RateLimiter) ·
  **Category:** TST (test infrastructure)
- **ADR references:** none dedicated — a direct application of ADR-0010's
  subpath-export convention and the kernel's zero-runtime-dependency charter
  (`docs/adr/0001-*.md`, manifest-rules fitness test)
- **Design docs:** [Architecture §44](../../../docs/architecture/ARCHITECTURE.md)
  (contract-suite framework, cross-tenant isolation suite)

## Contract

**Purpose:** declare a kernel port's normative behavior exactly once, as a
plain function, and run it against any implementation — the kernel's own
in-memory reference adapter or a real Postgres/Redis adapter in another
package — without that implementation duplicating the test cases by hand.

**Public surface (`@corestack/kernel/testing`):**

| Export                          | Purpose                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `SuiteHarness`                  | The test-runner primitives a suite needs (`describe`/`it`/`expect`/`beforeEach`/`afterEach`), typed but never imported at runtime |
| `defineCacheContractSuite`      | The `Cache` port's contract: get/set/delete round-tripping, TTL expiry        |
| `defineRateLimiterContractSuite` | The `RateLimiter` port's contract: fixed-window admit/deny, epoch-aligned reset, cost accounting, bucket independence |

## Why the suite never imports a test runner

`SuiteHarness`'s fields are typed via `import type { describe, it, expect,
beforeEach, afterEach } from "vitest"` — a type-only import that TypeScript
erases completely at compile time (confirmed: the emitted
`dist/testing/harness.js` is `export {};`, nothing else). A caller passes in
the exact `describe`/`it`/`expect` triple it already imported from its own
`vitest`. This is what keeps `@corestack/kernel/testing` at the same zero
runtime dependencies as the rest of the kernel (fitness-test-enforced,
`manifest-rules.test.mjs`): if the suite modules imported `vitest` as a
value, either kernel's `package.json` would need `vitest` listed as a real
dependency (defeating the zero-dependency charter) or the import would
silently rely on monorepo hoisting (fragile, undocumented coupling). Neither
is necessary — the suites are just functions; the harness is just a typed
parameter.

## Why factories take a `Clock`, not nothing

Both `Cache` (TTL expiry) and `RateLimiter` (fixed-window admission) are
contracts whose correctness depends on time, but neither port interface
exposes a clock — `InMemoryLruCache` and `PostgresRateLimiter` both take an
optional `clock` as a *constructor* option instead. A suite that only had
`() => Cache` to work with could only test TTL by actually waiting in real
time (slow, and still nondeterministic under CI scheduling jitter). Instead
each suite's factory signature is `(clock: FixedClock) => T | Promise<T>`:
the suite constructs the `FixedClock`, calls the factory with it, and
advances time deterministically (`clock.advance(999)` then `clock.advance(1)`
to straddle exact TTL/window boundaries). Every adapter this framework
targets already accepts a `clock` constructor option for exactly this
reason, so this isn't a new constraint the framework invents — it's the
existing convention, made mechanically reusable.

## Scope: the port's contract, not every adapter's extra behavior

`InMemoryLruCache`'s bounded-`maxEntries` LRU eviction is **not** part of
`defineCacheContractSuite` — the `Cache` interface itself (`get`/`set`/
`delete`) makes no capacity-bound promise, and there is currently no second
`Cache` adapter to prove a shared eviction contract against (ADR-0018
deferred the Postgres/Redis `Cache` backend). That test stays in
`packages/kernel/test/ports.test.ts` as an `InMemoryLruCache`-specific unit
test. The same principle governs `RateLimiter`: concurrent-store races
(`packages/platform/test/integration/rate-limiter.postgres.test.ts`'s
20-caller test) are Postgres-specific — no in-memory single-process adapter
can violate them — and stay out of the portable suite.

## Proof this framework does what it claims

**Acceptance criterion (E04-T01): "Kernel's in-memory impls pass their own
suites via the framework."** `packages/kernel/test/ports.test.ts` calls
`defineCacheContractSuite(harness, (clock) => new InMemoryLruCache({ clock }))`
and `defineRateLimiterContractSuite(harness, (clock) => new
InMemoryRateLimiter({ clock }))` directly — both pass (81 tests total in
that package, up from 74 pre-framework).

**Cross-adapter proof (the framework's actual value, beyond the acceptance
bar):** `packages/platform/test/integration/rate-limiter.postgres.test.ts`
calls the identical `defineRateLimiterContractSuite` against `(clock) => new
PostgresRateLimiter(sql, clock)` — the same test bodies, unmodified, now
verified against real PostgreSQL 18. This replaced two hand-mirrored
duplicate tests that existed before this task (allow-then-deny,
epoch-aligned reset) with the shared suite, and added three more contract
cases (bucket independence, multi-unit cost, cost-exceeds-limit) that the
hand-written Postgres test never had, at zero extra authoring cost.

## Failure modes

| Failure                                                          | Behavior                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Caller passes a factory whose implementation violates the contract | The relevant `it()` fails with a normal vitest assertion diff — same as any other test, nothing suite-specific |
| Caller's `describe`/`it`/`expect` come from a non-vitest runner    | Untested; the type signature assumes vitest's API shape (`toEqual`, `toBeUndefined`, etc.) even though nothing is imported at runtime — a differently-shaped runner would fail type-checking, not silently misbehave |

## Concurrency guarantees

None added by this layer — suites call the port under test the same way
any other test does; concurrency proofs (e.g. `RateLimiter`'s 20-concurrent-
caller race) are adapter-specific and live outside the portable suite (see
Scope above).

## Performance

Not applicable — this is test-time-only code, never shipped in a production
bundle (`sideEffects: false`, and the whole subpath is excluded from
`dist/index.js`'s import graph).

## Security considerations

None — test-only code with no runtime footprint. The zero-dependency
property is itself a supply-chain consideration: `@corestack/kernel/testing`
adds no new resolvable package to a consumer's dependency tree.

## Observability

Not applicable.

## Testing

Framework correctness is proven by use, not by a separate meta-test suite:
both contract suites are exercised for real against two different
implementations (kernel's in-memory adapters, platform's Postgres adapter)
as described above. No dedicated "test the test framework" file was added —
a suite with no adapter to run against proves nothing, so the proof is
inherently the conversion of real test files, not synthetic fixtures.

## Design rationale

**Why not accept `() => T` and let each suite roll its own timing hack?**
Every port this framework currently covers needs deterministic time to be
testable at all without real delays; standardizing on `(clock: FixedClock)
=> T` once, in the framework, means every future suite (E04-T03's remaining
five ports) gets this for free instead of re-solving it per port.

**Why `FixedClock` specifically, not the broader `Clock` interface?** A
contract suite needs to *drive* time (`.advance()`), not just read it —
`Clock`'s own interface is read-only (`now()`); `FixedClock` is the kernel's
existing concrete type for controllable time, already used by every
existing time-dependent test in this codebase. Requiring it directly (not a
generic `Clock`) keeps the suite's own code simple and avoids introducing a
new "advanceable clock" abstraction the codebase didn't already have.

**Why start with only Cache and RateLimiter, not all six kernel ports with
adapters?** E04-T01's acceptance bar is the framework plus proof it works
in both directions (in-memory and a real adapter); the remaining port
suites (EventBus, Encrypter, UnitOfWork, IdempotencyStore) are E04-T03's
explicitly separate, larger task. Building all six here would blur the two
tasks' scope and risk shipping suites for ports whose adapters (e.g. a
future Redis `EventBus`) don't exist yet to validate the design against.
