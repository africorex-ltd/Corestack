# Component Spec — Migration Format & Loader

- **Task:** E03-T01 · **Status:** Implemented · **Category:** APP/ADP (domain + application + infrastructure)
- **ADR references:** ADR-0015 (zero-downtime N/N+1 upgrades), ADR-0002 (monorepo/package layout), ADR-0004 (Postgres behind ports — this loader is the format layer the T02 runner builds on)
- **Design docs:** [Database §18](../../../docs/architecture/DATABASE.md) (migration strategy: expand-and-contract, lock-impact headers, forward-only), [decision 0001](../../../docs/decisions/0001-platform-package.md) (why this lives in `@corestack/platform`)

## Contract

**Purpose:** parse a module's directory of plain-SQL migration files into a
validated, version-ordered `MigrationSet` that the T02 runner can apply.

**Public surface** (all from `@corestack/platform`):

| Export                                         | Layer          | Purpose                                                                                               |
| ---------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `assertValidModuleName(name)`                  | domain         | Throws `ValidationError` on any name outside `[a-z][a-z0-9]*(-[a-z0-9]+)*` — the path-traversal guard |
| `parseMigrationVersion(filename)`              | domain         | Extracts the version from `NNNN_verb-noun.sql`                                                        |
| `parseMigrationHeader(filename, source)`       | domain         | Parses the leading `-- @key: value` block; separates the SQL body                                     |
| `computeChecksum(source)`                      | domain         | SHA-256 hex of the _entire_ raw file (async, WebCrypto)                                               |
| `parseMigrationFile(module, filename, source)` | domain         | Composes the four above into one `MigrationFile`                                                      |
| `MigrationSource` (port)                       | application    | `listMigrationFiles(module): Promise<RawMigrationFile[]>`                                             |
| `loadMigrationSet(module, source)`             | application    | Loads, parses, aggregates errors, validates ordering, returns `Result<MigrationSet, ValidationError>` |
| `FsMigrationSource`                            | infrastructure | Reference `MigrationSource`: reads `<baseDir>/<module>/*.sql`                                         |
| `InMemoryMigrationSource` (`/testing` subpath) | testing        | In-memory fake for consumer tests                                                                     |

## Failure modes

| Failure                                                                                          | Where                            | Behavior                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malformed filename (not `NNNN_verb-noun.sql`)                                                    | domain                           | Throws `ValidationError`; caught and aggregated by the loader                                                                                                                                                                                                         |
| Missing/invalid header key, bad `@lock-impact`, bad `@concurrent`, duplicate key, empty SQL body | domain                           | Throws `ValidationError`; aggregated                                                                                                                                                                                                                                  |
| Version gap or duplicate across a module's files                                                 | application                      | Reported in the `Result`'s error metadata (`issues: string[]`) — checked only _after_ every file individually parses clean, so one class of problem is never masked by another                                                                                        |
| Invalid module name                                                                              | domain (`assertValidModuleName`) | **Throws directly, not via `Result`** — a bad module name is a static call-site programming error (a typo in the composition root), not recoverable authoring input; matches the kernel's own convention (`createEvent`'s name validation throws for the same reason) |
| Filesystem I/O error other than "module directory missing"                                       | infrastructure                   | Rejects the promise (genuine unexpected failure, not an authoring mistake)                                                                                                                                                                                            |
| Missing module directory                                                                         | infrastructure                   | **Not a failure** — returns `[]` (a brand-new module simply has no migrations yet)                                                                                                                                                                                    |

## Retry / timeout / cancellation

**Deliberately none — documented, not omitted.** This component reads small
local text files synchronously-in-effect (the only `await` points are
`fs.readdir`/`fs.readFile` and one WebCrypto digest per file). It is not
subject to network partition, and realistic migration-set sizes (tens to
low hundreds of files) complete in single-digit milliseconds. Adding
retry/backoff or an `AbortSignal` here would be complexity with no matching
failure mode — the kind of premature abstraction the project's own
principles reject. If a future `MigrationSource` implementation talks to a
network resource (unlikely, but the port permits it), _that_ adapter is
where retry/timeout/cancellation belong, scoped to its own actual risk.

## Concurrency guarantees

Every function is pure with respect to shared state: no module-level
mutable state, no caching, no locks. Calling `loadMigrationSet` concurrently
— for the same module or different ones, from one process or many — is
always safe; each call only touches its own inputs and the read-only
filesystem. (Write concurrency — applying migrations against a live
database — is T02's concern, via an advisory lock at the runner level.)

## Performance

No formal benchmark yet (harness arrives E04-T13); informal budget: parsing

- hashing a realistic module (≤ 200 files, ≤ 50 KB total) should complete
  in low single-digit milliseconds excluding disk I/O. Allocation profile is
  proportional to input size (one parsed object + one hash per file); nothing
  is retained across calls.

## Security considerations

- **Path traversal:** structurally prevented, not just checked — module
  names are validated against a closed identifier pattern _before_ any path
  is constructed (`FsMigrationSource` calls `assertValidModuleName` as its
  first line), so no module name can ever escape `baseDir`.
- **Trust boundary:** migration files are repository content authored by
  contributors, not end-user input — but the parser still validates
  defensively (malformed headers, empty bodies) because "trusted" authors
  make mistakes and a loud parse error beats a silently-wrong migration.
- **No SQL execution here.** This component only produces `MigrationFile.sql`
  as a string; running it against a database is entirely T02's
  responsibility, keeping "can parse a file" separate from "can execute
  arbitrary SQL" as a security boundary between components.

## Observability — scoped deliberately

Per governance §5 ("observability is a first-class feature"), the explicit
scoping decision for _this_ component: it is a synchronous, boot/build-time
parsing utility with no network calls, no long-running state, and
sub-millisecond-per-file execution — not a running service. Full
observability (metrics, tracing spans, health indicators) belongs at the
**T02 runner** level, where migrations are actually applied against a
database over time and those signals have real operational value. This
component's only observability surface is that every failure is a
`ValidationError` carrying structured `metadata` (filename, module, specific
issue) — sufficient for a caller (the future CLI) to log or display
precisely what went wrong, without inventing logging/metrics machinery that
would sit idle in a function that runs once per module per boot.

## Operational runbook

Not yet applicable (no operational surface — see Observability above). The
runner (T02) will accrete runbook content into `docs/runbooks/platform.md`
once it exists; this component's authoring guidance (the header format,
worked examples) is E03-T04.

## Testing

39 tests across three layers: 29 domain (pure, no I/O), 6 application
(in-memory `MigrationSource` fake), 4 infrastructure (real temp-directory
filesystem — no Docker required, since this component never touches
Postgres). All failure modes above have a corresponding test; the
regression-testing discipline established for the kernel audit (test the
bug before the fix, keep it after) applies here too — see the module-name
hyphen gap in Lessons Learned below.

## Design rationale — why not a single flat function?

Domain/application/infrastructure separation exists here for the same
reason it exists everywhere else in CoreStack: the _rules_ (header format,
ordering, checksums) must be testable without a filesystem, and the
_mechanism_ (where files live) must be swappable without touching the
rules. A future in-database or bundled-at-build-time `MigrationSource` is a
new infrastructure adapter with zero changes to domain or application code
— exactly the "swap anything" promise the architecture makes for every
other port in the platform.
