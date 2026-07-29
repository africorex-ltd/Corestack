# Testcontainers Readiness (E04-T02 Preparation)

- **Effort:** E04 Consolidation and Release-Hardening Mode, Section 6.
- **Status:** documentation-only. **No runtime code in this repository
  assumes Docker is available**, and nothing in this document changes that.
  E04-T02 itself remains blocked — `docker info` fails on this development
  machine (first documented in ADR-0018, reconfirmed every time this
  blocker has come up since). This document exists so that unblocking T02,
  whenever a working Docker daemon becomes available, is a known,
  bounded piece of work rather than a fresh investigation.

## What already exists, and works today

The Testcontainers *path* is not missing — it is built, tested in its
non-Docker branch, and simply unexercised on this machine. The dual-mode
bootstrap (`packages/platform/test-support/test-database.ts`,
`createTestDatabase()`) already picks between two strategies:

- **Local mode** (`DATABASE_URL` set): admin-connects to a real Postgres
  instance, creates a throwaway scratch database per test file, drops it on
  `close()`. This is the mode every integration test and benchmark in this
  repository currently runs in, verified against local PostgreSQL 18.4.
- **Testcontainers mode** (`DATABASE_URL` unset): starts a fresh
  `postgres:16-alpine` container per call via `@testcontainers/postgresql`,
  exactly the pattern every test file used before the dual-mode bootstrap
  existed. This branch **compiles and typechecks** as part of this
  repository's normal `typecheck`/`lint`/`build` gates — those gates don't
  require Docker — but it has never been *executed* on this machine, since
  `DATABASE_URL` is always set here.

The gap E04-T02 needs to close is: prove the Testcontainers branch actually
works when run for real, then use it as CI's primary mode (CI has no
persistent `DATABASE_URL` to point at). It is not: build a Testcontainers
integration from scratch.

## Required Docker setup

- A working Docker daemon reachable via the default socket/named pipe
  (`docker info` must succeed) — the exact thing currently failing on this
  development machine.
- Ability to pull `postgres:16-alpine` (already pinned in
  `test-database.ts`; matches the version note in
  `docs/platform/postgres-18-compatibility.md`'s discussion of why 16 was
  the prior baseline).
- No other image is currently required. The blueprint's original E04-T02
  description (`docs/engineering/01-foundation.md`, row E04-T02) names
  "Postgres/Redis/MinIO lifecycle helpers" with sub-tasks for Redis and
  MinIO — but ADR-0018 permanently deferred a Redis-backed `Cache` adapter,
  and no MinIO-backed (object storage) component exists anywhere in this
  codebase today. **T02's real, current scope is Postgres-only.** The
  Redis/MinIO sub-tasks in the blueprint apply only if/when those adapters
  are actually built — until then, adding container lifecycle code for
  services with no adapter to test would be exactly the "speculative
  Testcontainers code" this document's own governing directive prohibits.

## Expected services

| Service | Needed today? | Why |
| --- | --- | --- |
| PostgreSQL | Yes | Every integration test and benchmark in the repository targets it; already wired via `test-database.ts` |
| Redis | No | ADR-0018 defers a Redis `Cache` adapter indefinitely; add only when that adapter is actually built |
| MinIO / object storage | No | No component in this codebase uses object storage; add only when one exists |

## CI topology (target state, once unblocked)

1. CI has no persistent database — `DATABASE_URL` stays unset in the CI
   environment, so `createTestDatabase()` falls through to Testcontainers
   mode automatically. No code change is needed to make this the CI path;
   it already is the `else` branch.
2. Each integration test **file** starts its own container (current
   behavior, matches the pre-dual-mode pattern every file already used) —
   per-file isolation, not a single shared container across the whole
   suite. This avoids the cross-file collision risk a shared container
   would introduce.
3. `--no-file-parallelism` (already set on the `bench` script, and already
   the effective behavior of `test:integration`'s per-file container
   startup) should be evaluated for the integration test lane too once
   Testcontainers mode is live in CI — concurrent container starts are a
   plausible source of CI flakiness/resource pressure that local mode's
   shared-instance-plus-scratch-database approach doesn't have. E01-T07's
   original acceptance criterion ("cold-start < 30s in CI") should be
   re-measured once this is running for real, not assumed to still hold
   three PostgreSQL major versions later (16-alpine in the container vs. 18
   locally).
4. Image pulls should use CI's layer cache (standard for whatever CI
   provider is chosen) so cold-start isn't dominated by a fresh
   `postgres:16-alpine` pull on every run.

## Local topology (current state, unchanged by this document)

Local development keeps using `DATABASE_URL` mode by default — it is
faster (no container startup per file), already verified against
PostgreSQL 18.4, and requires no Docker at all, which matters concretely on
this machine. A developer *can* unset `DATABASE_URL` locally to exercise
the Testcontainers branch directly, once Docker is available to them — the
dual-mode design means this requires no flag, no separate script, just the
presence or absence of one environment variable.

## Migration strategy from `DATABASE_URL` mode

There is no migration required in the sense of replacing one mode with the
other — the dual-mode bootstrap was built specifically so both remain
first-class, permanently:

1. **Local development** stays on `DATABASE_URL` mode indefinitely — it's
   strictly better for a developer's inner loop once a local Postgres
   instance exists, Testcontainers or not.
2. **CI** adopts Testcontainers mode by simply *not* setting
   `DATABASE_URL` in the CI job's environment — `createTestDatabase()`
   requires zero code changes to make this switch, since the branch already
   exists and already typechecks.
3. **Verification before trusting CI's path**: once a Docker daemon is
   available anywhere (a developer machine with Docker, or the CI runner
   itself), run the existing integration suite once with `DATABASE_URL`
   deliberately unset, to prove the Testcontainers branch behaves
   identically to local mode — not just that it starts, but that every
   currently-passing integration test still passes through it. This is the
   single piece of *new* verification work T02 requires; everything else
   above is topology decisions, not code.
4. **Bench scripts** (`packages/platform/bench/*.bench.ts`) use the same
   `createTestDatabase()` and need no separate migration — they already
   inherit whichever mode the environment selects.

## Acceptance criteria for unblocking T02

1. A working Docker daemon is available in at least one environment
   (developer machine or CI runner).
2. The full `test:integration` suite passes with `DATABASE_URL` unset,
   exercising the Testcontainers branch end to end, with a result recorded
   (pass/fail, timing) the same way the PG16→18 compatibility verification
   was recorded in `docs/platform/postgres-18-compatibility.md` — this
   document's own template for "prove a mode switch is safe with a written,
   dated record," not just a green CI run nobody wrote down.
3. Cold-start timing is measured against the original E01-T07 acceptance
   criterion ("cold-start < 30s in CI") and either confirmed or the
   criterion is explicitly revised with a stated reason.
4. If Redis or MinIO adapters exist by the time this is unblocked, their
   own Testcontainers lifecycle helpers are added as a separate, explicit
   sub-scope — not assumed to be covered by this Postgres-only preparation.
5. The certification matrix and this document are both updated to reflect
   T02 as unblocked, with the date and environment it was verified in.

## What this document does not do

Per this directive's own explicit constraint, this document adds **no
runtime code**. `test-database.ts`'s Testcontainers branch already existed
before this session; nothing here modifies it, and no new lifecycle helper
for Redis or MinIO has been added, since no adapter exists yet to justify
one. This is preparation and acceptance-criteria documentation only.
