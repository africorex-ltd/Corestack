# Lessons — E03 Tenant Isolation & Shared Postgres Adapters (T23, T30-T33, T40-T43), written 2026-07-29

Second and final lessons file for E03, covering everything after the
outbox epic: health/readiness (T23), tenant-isolation infrastructure
(T30-T33), and the shared Postgres adapter base (T40-T43). See
[e03-outbox-epic.md](e03-outbox-epic.md) for the first half and
[E03-exit-report.md](../reviews/E03-exit-report.md) for the full epic-exit
status this file supports.

## Good decisions

- **A repeatable, pre-implementation empirical-verification pass caught
  three real bugs before they shipped, not after.** Writing a throwaway
  script against real Postgres to test a specific behavioral assumption —
  before writing the production code that depends on it — was used
  deliberately three times this stretch, and each time it caught something
  that unit tests alone would not have:
  - **T30:** `current_setting('app.current_org', true)` returns `NULL`
    only on a connection that has _never_ set that GUC; once any
    transaction has touched it, a later transaction that forgets to set it
    again sees `''` (empty string), not `NULL`. This directly shaped the
    RLS policy design (deliberately omitting `missing_ok` so a forgotten
    `withOrgContext` call fails loudly, never silently).
  - **T41:** untyped bind parameters compare as `text` when there's no
    column context to infer from — `10 <= 5` evaluated `true`
    lexicographically (`'1' < '5'`), which would have silently allowed an
    over-limit request through on a fresh rate-limit bucket.
  - **T43:** a second connection's `INSERT ... ON CONFLICT` on the same
    key genuinely blocks on Postgres's row-level lock until the first
    connection's statement commits — proving that `begin()`/`complete()`
    must never be nested inside the caller's own use-case transaction, or
    every losing concurrent caller would block for the _winner's entire
    request_, not just its lock-acquisition step.

  None of these three came from reading documentation or from unit tests
  against an in-memory fake — all three came from running two lines of
  real SQL against a real database and looking at what actually happened.
  This is now an established practice worth carrying into E04's
  port-contract-suite work verbatim.

- **Reading the port/blueprint row before writing code caught two scope
  corrections, not two designs.** T42's blueprint row asked for an
  "in-memory... adapter," but grepping kernel first showed E02-T07 had
  already shipped `InMemoryLruCache` with its own tests — there was no
  second in-memory adapter to build, only a decision note to write
  (ADR-0018). T43's blueprint row assumed a kernel `IdempotencyStore` port
  already existed (it's categorized `ADP`, same as T41's adapter-only
  `RateLimiter` task) — but no E02 task had ever created it; only
  cross-referencing E04-T03's port enumeration confirmed the port
  belonged in the kernel rather than in `platform`. Both corrections came
  from a five-minute grep before any code was written, not from a
  redesign after the fact.

- **Type-level enforcement was verified by deliberately breaking it.**
  T31's compile-time guarantee ("type error, not runtime error, when an
  org-scoped helper is called without an org") was proven by temporarily
  deleting the test's `@ts-expect-error` annotation, confirming `tsc`
  reported exactly the expected `TS2345`, then restoring it — rather than
  trusting that the type signature "looked right."

## Mistakes (caught before shipping)

- **A comparison-clock mismatch nearly shipped in T43.** An early version
  of `PostgresIdempotencyStore` compared `expires_at` against Postgres's
  own SQL `now()`. Under this package's `FixedClock`-based tests (used
  throughout for determinism), Postgres's real wall-clock `now()` is
  almost always later than the test's simulated instant — so the reclaim
  guard fired unconditionally, and every test expecting `inProgress` or
  `replay` instead saw `started`. Caught immediately (4 of 9 integration
  tests failed on the very first run), fixed by binding the injected
  `Clock`'s value as an explicit SQL parameter on both sides of every
  expiry comparison. **Lesson: any adapter whose production code takes an
  injectable `Clock` must never compare against the database's own time
  function — every comparison needs the same time source on both sides,
  or tests built around a controllable clock will fail in ways that look
  like logic bugs but are actually clock-source bugs.**

- **A `postgres.js` typing gap looked like a runtime hang.** `ReservedSql`
  (from `sql.reserve()`) types `.begin()` as available via `extends
Sql<T>`, but it's `undefined` at runtime in the installed version
  (`postgres@3.4.9`). The first attempt to use it threw inside an
  unawaited/uncaught promise, which manifested as the process appearing
  to hang indefinitely with zero output — traced only by adding explicit
  step-tracing and a hard shell timeout. Abandoned the reserve+begin
  approach for T31 in favor of a directly-authenticated test connection,
  which turned out to be a strictly better design anyway (proves the
  real production connection shape, not a reserved-connection
  workaround).

## Mistakes (caught after committing, via review)

- **T23's `countBacklog` had a torn read on first commit.** The original
  implementation ran `getCheckpoint()` then a separate `count(*)` query —
  a concurrent `advanceCheckpoint` between the two statements could
  produce a backlog count relative to an already-stale cursor. Caught by
  advisor review shortly after committing, fixed by folding both into one
  atomic `COALESCE`-based query. **Lesson: any "read two related facts,
  then compute from both" pattern is a torn-read candidate unless it's one
  statement — this should be checked at design time, not discovered by
  review afterward.**

- **T31's "fail-loud, never silent" claim was only proven for the wrong
  connection shape.** T30 proved that a forgotten `withOrgContext` call
  fails loudly (not a silent leak, not a silent empty result) — but only
  against a superuser session using `SET LOCAL ROLE`. T31 then shipped its
  own real app-role connection without re-proving the same claim against
  _that_ connection shape. Advisor review caught the gap after commit; a
  follow-up test (raw query on the same pooled app-role connection,
  outside the helper, asserting it throws) closed it. **Lesson: a safety
  property proven once, under one connection shape, is not automatically
  proven for every connection shape a later task introduces — each new
  connection shape that touches the same guarantee needs its own direct
  test, not an inherited assumption.**

## Surprises

- **Postgres superusers bypass RLS even with `FORCE ROW LEVEL SECURITY`
  set** — this is documented Postgres behavior (table owners and
  superusers are exempt from `FORCE`), but it's easy to write a test that
  asserts the _opposite_ by accident. This session's T30 suite originally
  had a test titled "the table owner (superuser) is still subject to RLS
  once FORCE is set" whose assertion actually proved the reverse — caught
  and renamed during self-review, but a useful reminder that a
  misleadingly-named test can pass for the wrong reason and look correct
  at a glance.
- **A kernel port can be a blueprint-assumed prerequisite that nothing
  ever created.** T43 is the first case this epic where a task's own
  category (`ADP`, adapter) implied a port that simply didn't exist yet.
  Worth checking this explicitly for any future adapter task: does the
  port it's meant to adapt actually exist, or does the "ADP" label just
  assume an earlier task shipped it?
- **A dashboard test-file count that "already looked right" turned out to
  be pre-existing drift, not a live discrepancy.** Recomputing `9 (kernel)
  - 2 (lint) + 3 (architecture) + 23 (platform unit) + 14 (platform
    integration, post-T43) = 51` matched the dashboard's already-recorded
    "51 files" — but the same arithmetic _before_ T43's new integration file
    gives 50, meaning the pre-T43 dashboard number was already off by one
    and nobody had noticed. It self-corrected by coincidence when T43 added
    exactly one file. **Lesson: a number matching what's already written is
    not the same as a number that was actually re-derived — verify the
    arithmetic itself, not just that it agrees with the existing value.**

## Future improvements

- **Platform's own tables (`outbox`, `rate_limits`, `idempotency_keys`)
  have no tracked-migration history of their own** — each is bootstrapped
  by an `ensure*Schema` function doing `CREATE TABLE IF NOT EXISTS`
  in application code, not through T02's migration runner. T02 gives every
  _module's_ schema checksum drift detection; platform's own schema gets
  none of that for itself. Not an incident yet (none of these tables have
  changed shape since shipping), but the next time one does, there's no
  forced-ordering or drift-detection mechanism catching a mismatch between
  what's deployed and what the code expects. Named explicitly in the exit
  report as tracked debt with no retirement task yet.
- Keep the empirical-verification-before-coding habit for E04's
  port-contract-suite work specifically — writing a shared contract suite
  that's meant to catch adapter/reference divergence is exactly the kind
  of work where an unverified assumption about database behavior (like
  the three caught this epic) would otherwise get baked into the suite
  itself rather than caught by it.
