# @corestack/platform

> **Status: In progress** — the `platform` schema machinery every module
> depends on (Architecture §45, §47; ADR-0016;
> [decision 0001](../../docs/decisions/0001-platform-package.md)).
> Grows task-by-task per [blueprint E03](../../docs/engineering/01-foundation.md);
> see the **Public API guide** below for exactly which tasks are done.

## What this package is

The infrastructure layer beneath every module: migrations, the
transactional outbox, the composition root, and tenant-isolation
scaffolding (RLS harness, org-scoped repository helpers). Where the kernel
is deliberately runtime-agnostic and business-free, `platform` is where
CoreStack's actual infrastructure — filesystem, Postgres, process
lifecycle — lives, always behind a port a module or adopter can replace.

## Architecture overview

Every capability in this package follows the same Clean Architecture
layering as a full module (Architecture §45), even though `platform` itself
isn't a bounded-context module:

```
src/
  domain/          pure logic — parsing, validation, identity (no I/O, no Node builtins)
  application/      ports + orchestration (no infrastructure, no Node builtins)
  infrastructure/  adapters — filesystem, Postgres (Node/vendor APIs allowed)
  postgres/        barrel re-exporting Postgres adapters, published as "./postgres"
  testing/         in-memory fakes, exported via the "./testing" subpath
```

`postgres` (the driver) is an **optional peer dependency** (ADR-0010) —
only importing from `@corestack/platform/postgres` pulls it in; the main
`.` entry point stays dependency-light for adopters using only the pure/
in-memory parts.

Each capability gets a **component spec** under `docs/` — contract, failure
modes, retry/timeout/cancellation posture, concurrency guarantees,
performance budget, security considerations, and observability scoping
(Platform Maturity Mode governance §4). See
[docs/migration-loader.md](docs/migration-loader.md) for the first one.

## Public API guide

| Capability                                                   | Status         | Entry point                                                                                                                                                              |
| ------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migration format & loader                                    | ✅ E03-T01     | `parseMigrationFile`, `loadMigrationSet`, `FsMigrationSource` — see [component spec](docs/migration-loader.md)                                                           |
| Module lifecycle contract                                    | ✅ E03-T20     | `ModuleFactory`, `ModuleInstance`, `checkModuleConformance` — see [component spec](docs/module-lifecycle.md)                                                             |
| Config validation framework                                  | ✅ E03-T22     | `loadAllModuleConfigs`, `loadModuleConfig`, `SecretResolver` — see [component spec](docs/config-validation.md)                                                           |
| `createCoreStack()` composition helper                       | ✅ E03-T21     | `createCoreStack`, `CoreStack` — see [component spec](docs/create-core-stack.md)                                                                                         |
| Graceful shutdown orchestration                              | ✅ E03-T24     | `shutdownGracefully`, `Drainable` — see [component spec](docs/graceful-shutdown.md)                                                                                      |
| Context resolution (ADR-0008 layer 2)                        | ✅ E03-T32     | `resolveContext`, `MembershipLookup` — see [component spec](docs/resolve-context.md)                                                                                     |
| Migration runner (`platform.module_migrations`)              | ✅ E03-T02     | `runMigrations`, `PostgresMigrationRunnerStore` (`./postgres`) — see [component spec](docs/migration-runner.md)                                                          |
| Outbox schema bootstrap                                      | ✅ E03-T10     | `ensureOutboxSchema` (`./postgres`) — see [component spec](docs/outbox-schema.md)                                                                                        |
| Outbox writer                                                | ✅ E03-T11     | `writeOutboxEvents`, `createOutboxStaging` (`./postgres`) — see [component spec](docs/outbox-writer.md)                                                                  |
| Outbox relay                                                 | ✅ E03-T12     | `OutboxRelay`, `PostgresOutboxRelayStore` (`./postgres`) — see [component spec](docs/outbox-relay.md)                                                                    |
| Crash-consistency test suite                                 | ✅ E03-T13     | 3 real-Postgres scenarios (crash before commit / pre-dispatch / mid-dispatch) — see [component spec](docs/outbox-crash-consistency.md)                                   |
| Idempotent consumer helper (Postgres)                        | ✅ E03-T14     | `PostgresProcessedEventStore` (`./postgres`) — see [component spec](docs/processed-event-store.md)                                                                       |
| Outbox partition maintenance (create-ahead + retention-drop) | ✅ E03-T03     | `maintainOutboxPartitions` (`./postgres`) — see [component spec](docs/outbox-partition-maintenance.md)                                                                   |
| Health/readiness computation                                 | ✅ E03-T23     | `checkLiveness`, `checkReadiness`, `RelayLagRecorder`, `PostgresDatabasePing`/`PostgresMigrationsStatus` (`./postgres`) — see [component spec](docs/health-readiness.md) |
| RLS / tenant-isolation harness                               | ✅ E03-T30     | `buildTenantIsolationDdl`, `ensureTenancyRoles`/`withOrgContext` (`./postgres`) — see [component spec](docs/tenant-isolation.md)                                         |
| Org-scoped repository base utilities                         | 📋 E03-T31     | —                                                                                                                                                                        |
| Purge protocol framework                                     | 📋 E03-T33     | —                                                                                                                                                                        |
| Shared Postgres adapter base                                 | 📋 E03-T40–T43 | —                                                                                                                                                                        |

## Example usage (migration loader)

```ts
import { FsMigrationSource, loadMigrationSet } from "@corestack/platform";
import { isOk } from "@corestack/kernel";

const source = new FsMigrationSource({ baseDir: "./migrations" });
const result = await loadMigrationSet("tenancy", source);

if (isOk(result)) {
  for (const migration of result.value.migrations) {
    console.log(
      `${migration.filename}: ${migration.header.description} (lock: ${migration.header.lockImpact})`,
    );
  }
} else {
  console.error(result.error.message, result.error.metadata);
}
```

Migration file format (`migrations/tenancy/0001_create-organizations.sql`):

```sql
-- @description: Create the organizations table
-- @lock-impact: none

CREATE TABLE tenancy.organizations (id uuid PRIMARY KEY);
```

## Example usage (module lifecycle contract)

Every module — including future first-party ones — exports a factory
matching `ModuleFactory<TDeps, TConfig, TUseCases>`:

```ts
import type { Clock, IdGenerator } from "@corestack/kernel";
import type { ModuleFactory } from "@corestack/platform";

interface WidgetsDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
interface WidgetsConfig {
  readonly defaultColor: string;
}
interface WidgetsUseCases {
  createWidget(): { id: string; createdAt: Date };
}

export const createWidgetsModule: ModuleFactory<WidgetsDeps, WidgetsConfig, WidgetsUseCases> = (
  deps,
  _config,
) => ({
  useCases: {
    createWidget: () => ({ id: deps.ids.generate(), createdAt: deps.clock.now() }),
  },
  eventHandlers: [],
  health: () => ({ status: "healthy" }),
});
```

The composition root (`createCoreStack()`, E03-T21) calls
`checkModuleConformance` on every module it wires — including third-party
ones it never compiled against these types — so a malformed module fails
loudly at boot with every problem listed at once.

## Example usage (config validation)

```ts
import { z } from "zod";
import { loadAllModuleConfigs, ProcessEnvSource, type ModuleConfigSpec } from "@corestack/platform";

const authConfig: ModuleConfigSpec<{ port: number; sessionSecret: string }> = {
  moduleName: "auth",
  schema: z.object({ port: z.coerce.number().int().positive(), sessionSecret: z.string().min(16) }),
  envMapping: {
    port: "AUTH_PORT",
    sessionSecret: { envKey: "AUTH_SESSION_SECRET", secret: true }, // may be "ref:..."
  },
};

const result = await loadAllModuleConfigs({ specs: [authConfig], env: new ProcessEnvSource() });
if (!result.ok) {
  // result.error.metadata.issues lists every problem, across every module —
  // never a value, secret or not.
  console.error(result.error.message, result.error.metadata.issues);
  process.exit(1);
}
```

## Example usage (composition root)

The adopter's own composition script calls each module's factory directly
— explicit, no reflection — then hands the built instances to
`createCoreStack()` for cross-cutting wiring:

```ts
import {
  InMemoryEventBus,
  SystemClock,
  UuidGenerator,
  InMemoryUnitOfWork,
  NoopLogger,
} from "@corestack/kernel";
import { createCoreStack } from "@corestack/platform";
import { createWidgetsModule } from "./modules/widgets.js"; // your own module

const eventBus = new InMemoryEventBus();
const kernel = {
  clock: new SystemClock(),
  ids: new UuidGenerator(),
  logger: new NoopLogger(),
  eventBus,
  unitOfWork: new InMemoryUnitOfWork(eventBus),
};

const widgets = createWidgetsModule(kernel, { defaultColor: "blue" });

const stack = createCoreStack({ eventBus, modules: { widgets } });
console.log(await stack.health()); // { status: "healthy", modules: { widgets: { status: "healthy" } } }
```

## Example usage (graceful shutdown)

```ts
import { shutdownGracefully, type Drainable } from "@corestack/platform";

const httpListener: Drainable = {
  name: "http-listener",
  stopIntake: async () => server.close(),
  drain: async () => server.closeAllConnections(),
};

process.on("SIGTERM", async () => {
  const report = await shutdownGracefully({
    drainables: [httpListener /* , outboxRelay, jobQueue, dbPool — arrive with T12+ */],
    drainTimeoutMs: 10_000,
    logger,
  });
  process.exit(report.clean ? 0 : 1);
});
```

## Example usage (context resolution)

```ts
import { resolveContext, type MembershipLookup } from "@corestack/platform";
import { isOk } from "@corestack/kernel";

// Real implementation queries tenancy.memberships; never trust the header directly.
const membershipLookup: MembershipLookup = {
  isActiveMember: async (userId, organizationId) => membershipRepo.isActive(userId, organizationId),
};

// actor comes from the auth module (session/API key already verified);
// claimedOrgId comes from an untrusted request header/path segment.
const result = await resolveContext(
  { actor, claimedOrganizationId: claimedOrgId },
  membershipLookup,
  ids,
);
if (!isOk(result)) {
  // Same 403 whether the org doesn't exist or the actor isn't a member.
  return respond403();
}
const context = result.value; // trustworthy from here on
```

## Example usage (migration runner)

```ts
import postgres from "postgres";
import {
  ensureMigrationTrackingSchema,
  PostgresMigrationRunnerStore,
} from "@corestack/platform/postgres";
import { FsMigrationSource, loadMigrationSet, runMigrations } from "@corestack/platform";
import { isOk } from "@corestack/kernel";

// Pool must allow >= 2 connections: one holds the advisory lock, one runs
// the migration transactions.
const sql = postgres(process.env.DATABASE_URL!, { max: 5 });
await ensureMigrationTrackingSchema(sql);

const store = new PostgresMigrationRunnerStore(sql);
const source = new FsMigrationSource({ baseDir: "./migrations" });

for (const moduleName of ["tenancy", "auth"]) {
  const migrationSet = await loadMigrationSet(moduleName, source);
  if (!isOk(migrationSet)) throw migrationSet.error;
  const result = await runMigrations(migrationSet.value, store);
  if (!isOk(result)) throw result.error; // drifted history — stop, don't guess
  console.log(
    `${moduleName}: applied versions ${result.value.appliedVersions.join(", ") || "(none — up to date)"}`,
  );
}
```

## Testing guide

```bash
pnpm --filter @corestack/platform test                # 179 tests, no database required
pnpm --filter @corestack/platform test:integration     # +55 tests, real Postgres — see below
pnpm --filter @corestack/platform typecheck
```

Testing a consumer of these ports? Use the fakes under the `/testing`
subpath rather than mocking:

```ts
import {
  InMemoryMigrationSource,
  InMemoryEnvSource,
  InMemorySecretResolver,
  InMemoryMembershipLookup,
  InMemoryMigrationRunnerStore,
} from "@corestack/platform/testing";
```

Postgres-backed capabilities (T02, T10-T14, T03) are wired into the
`test:integration` lane, not `test` — see
[tooling/ci/integration-manifest.json](../../tooling/ci/integration-manifest.json),
which every such capability must be added to (and CI enforces the match
exactly).

`test:integration` targets Postgres through a dual-mode bootstrap
(`test-support/test-database.ts`), never Testcontainers directly:

- **`DATABASE_URL` set** (local development): connects to that Postgres
  instance and creates/drops a throwaway scratch database per test file —
  no Docker required. Verified against a local PostgreSQL 18.4 instance;
  see [docs/platform/postgres-18-compatibility.md](../../docs/platform/postgres-18-compatibility.md).
- **`DATABASE_URL` unset** (CI, or no local Postgres): starts a fresh
  `postgres:16-alpine` Testcontainer per test file instead, unchanged
  from this package's original approach.

Both modes give every test file its own isolated database — `platform.*`
inside it is still exactly the same schema, so no test code differs
between modes.

## Common pitfalls

- **Module names must match `[a-z][a-z0-9]*(-[a-z0-9]+)*`.** Hyphens are
  allowed (third-party modules like `acme-crm`, Architecture §24) but
  leading/trailing/double hyphens and uppercase are rejected.
- **Migration versions must be sequential starting at 1, no gaps.** A
  deleted or renumbered file produces a loud, aggregated error rather than
  silently skipping — this is deliberate (see the component spec's
  ordering rationale).
- **The checksum covers the whole file, header included.** Editing only
  the `@lock-impact` line still changes the checksum — this is intentional
  so drift detection (T02) catches header edits too.
- **`ref:` secret-reference syntax only applies to fields marked `secret: true`.**
  A non-secret field whose literal value happens to start with `ref:` is
  used as-is, not resolved — special-casing every `ref:`-prefixed string
  platform-wide would be surprising action-at-a-distance.
- **The migration-lock connection pool needs `max >= 2`.** One connection
  holds the advisory lock for the whole per-module run; a pool of size 1
  deadlocks (the migration transactions have nowhere to run).
- **`platform.module_migrations` stores one row per module, not one per
  migration file.** Drift detection works via a cumulative chain checksum
  over the whole applied history (see the migration-runner component spec)
  — this is a property of the checksum, not something you need to manage.

## Extension points

- **Bring your own `MigrationSource`.** The filesystem adapter is the
  reference; a bundled-at-build or database-backed source is a drop-in
  replacement with zero changes to `loadMigrationSet` or the domain parser.
- **Every future capability in this package follows the same pattern:**
  a port in `application/`, a reference adapter in `infrastructure/`, a
  fake in `testing/` — consistent with every module going forward.

## Design rationale

See [docs/migration-loader.md § Design rationale](docs/migration-loader.md#design-rationale--why-not-a-single-flat-function)
and [decision 0001](../../docs/decisions/0001-platform-package.md) for why
this is a separate package rather than kernel growth.

## Architecture Scorecard

_(Governance §11.3 — summarized into the Engineering Health Report at epic exit.)_

| Dimension       | Assessment                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| Testability     | High — 179 unit tests (no database) + 55 real-Postgres integration tests across the shipped capabilities   |
| Maintainability | High — one capability, one clear layering, no cross-cutting state                                          |
| Complexity      | Low — pure functions + one small adapter; no retry/timeout machinery added without a matching failure mode |
| Documentation   | Complete for what exists (component spec + README); grows per task                                         |
| Performance     | Informal budget documented; formal benchmark pending E04-T13                                               |
| Security        | Path-traversal guard is structural (validated before path construction), not a runtime string check        |
| API stability   | Pre-publish; no consumers yet — surface may still shift before E03 exit                                    |
