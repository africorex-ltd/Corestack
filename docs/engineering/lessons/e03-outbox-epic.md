# Lessons — E03 Outbox Epic (T02-T03, T10-T14), written 2026-07-28

Written at the Infrastructure Consolidation checkpoint, covering the
transactional-outbox portion of E03 (schema, writer, relay, crash
consistency, idempotent-consumer helper, partition maintenance). **This is
a sub-epic checkpoint, not the full E03 exit lessons file** — E03 itself
is still in progress (T23, T30/T31/T33, T40-T43 remain); the entry
review's promised full Engineering Health Report + lessons-learned lands
at actual E03 exit. See
[E03-outbox-milestone-report.md](../reviews/E03-outbox-milestone-report.md)
for this checkpoint's fuller status snapshot.

## Good decisions

- **Discovering and reusing `ISql` across the whole epic.** `postgres`'s
  `ISql` interface (the common supertype of `Sql` and `TransactionSql`)
  meant `writeOutboxEvents`, `OutboxRelay`, and
  `PostgresProcessedEventStore` all serve a bare pool and an open
  transaction through one code path each, instead of the two-path split
  T02's migration runner genuinely needed for a different reason
  (`@concurrent` autocommit can't run in `.begin()`). One discovery in
  T11, reused deliberately in T12 and T14 rather than rediscovered.
- **Deliberately not building `UnitOfWork` early.** T11/T12/T14 all use
  `sql.begin()` directly rather than preempting E03-T40's not-yet-designed
  contract. Cheaper to document the gap honestly (see
  outbox-architecture.md's stage 1/2 table) than to guess at a port
  shape and have T40 redesign around it later.
- **Testing the "dangerous case" explicitly, not just the happy path.**
  Partition retention's empty-checkpoint-means-never-processed property
  (T03) got its own named integration scenario before the feature shipped
  — the same discipline the E01/E02 lessons file called out as a gap to
  close ("reference implementations need adversarial failure-path tests
  from birth"). This epic did that from the start.

## Mistakes

- **The partition-bound timezone bug would have shipped without an
  empirical check.** Bare `YYYY-MM-DD` DDL literals parse in the DDL
  session's `TimeZone`, not UTC — nothing in the design docs called this
  out, and it was only caught by writing a throwaway script against real
  Postgres before trusting the "obviously correct" date-string approach.
  Lesson: for any DDL that embeds a literal Postgres will parse
  server-side, verify the parse under a non-UTC session before assuming
  ISO-looking strings are unambiguous.
- **The jsonb payload round-trip bug was a one-line habit, not a design
  flaw.** `JSON.stringify`-ing a payload before insert is the instinctive
  thing to do coming from most other databases, and it inserts into
  jsonb without error — the bug only surfaces on read-back. Lesson:
  any adapter touching a jsonb/json column needs an explicit round-trip
  test (write then read, assert deep equality on the object, not just
  "insert didn't throw"), because the write path alone will never reveal
  this class of bug.
- **Test-isolation gaps hide in tables the fixture doesn't own.** T13's
  crash-consistency suite dropped `platform` schema between tests but
  left ad-hoc `invoices`/`delivered_effects` tables (created for that
  suite's own scenarios) to accumulate rows across tests, corrupting a
  later assertion's expected count. Lesson: a test's `beforeEach` must
  reset every table the test touches, not just the ones the module under
  test owns.

## Surprises

- Docker Desktop's local memory ceiling (~700MB on this machine) turned
  "run the integration suite" into an intermittent flake once the suite
  grew past ~6 Testcontainers-backed files running in parallel by
  vitest's default file-parallelism — not a code bug, a local resource
  constraint, fixed with `--no-file-parallelism` and irrelevant to CI
  (more memory there). Worth knowing before assuming a red run means a
  real regression.
- Row-value tuple comparison (`WHERE (occurred_at, id) > (...)`) matters
  more than it looks like it should: two events sharing an exact
  `occurred_at` timestamp are common enough in a batch-written system
  that a naive two-column `AND` cursor comparison would have silently
  dropped events in production, not just in a contrived test.
- `vitest`'s CLI has no `--include` flag — overriding which files a
  script picks up requires a dedicated config file
  (`vitest.bench.config.ts`), not a CLI override. Found only by trying
  the flag and reading the CAC error, not documentation.

## Future improvements

- Keep writing the regression test for the exact bug shape before fixing
  it (timezone bound, jsonb round-trip, test-isolation leak) — every real
  bug this epic caught was caught this way, none by inspection alone.
- The observability contract (outbox-observability.md) documents mostly
  **not-yet-implemented** metrics/logs. The next contributor to touch the
  relay or partition maintenance should wire at least one of them
  (`checkpoint advanced`, `retention completed`) rather than let the
  contract-only state persist indefinitely — a contract nobody implements
  is a lesson half-learned.
- `docs/runbooks/platform.md` was named in the E03 entry review as the
  runbook's future home before any runbook existed; it silently diverged
  from where the runbook actually landed (`docs/operations/`) until this
  consolidation pass caught it. Lesson: a placeholder path written before
  the real thing exists should be flagged for revisit at the point the
  real thing is built, not assumed still correct.
