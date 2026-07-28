# @corestack/platform

> **Status: In progress** — the `platform` schema machinery every module
> depends on (Architecture §45, §47; ADR-0016;
> [decision 0001](../../docs/decisions/0001-platform-package.md)).
> Grows task-by-task per [blueprint E03](../../docs/engineering/01-foundation.md);
> the migration loader (E03-T01) and module lifecycle contract (E03-T20)
> exist so far.

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
  infrastructure/  adapters — filesystem, and later Postgres (Node/vendor APIs allowed)
  testing/         in-memory fakes, exported via the "./testing" subpath
```

Each capability gets a **component spec** under `docs/` — contract, failure
modes, retry/timeout/cancellation posture, concurrency guarantees,
performance budget, security considerations, and observability scoping
(Platform Maturity Mode governance §4). See
[docs/migration-loader.md](docs/migration-loader.md) for the first one.

## Public API guide

| Capability                                      | Status         | Entry point                                                                                                    |
| ----------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| Migration format & loader                       | ✅ E03-T01     | `parseMigrationFile`, `loadMigrationSet`, `FsMigrationSource` — see [component spec](docs/migration-loader.md) |
| Module lifecycle contract                       | ✅ E03-T20     | `ModuleFactory`, `ModuleInstance`, `checkModuleConformance` — see [component spec](docs/module-lifecycle.md)   |
| Migration runner (`platform.module_migrations`) | 📋 E03-T02     | —                                                                                                              |
| Transactional outbox (writer + relay)           | 📋 E03-T10–T14 | —                                                                                                              |
| `createCoreStack()` composition helper          | 📋 E03-T21–T24 | —                                                                                                              |
| RLS / tenant-isolation harness                  | 📋 E03-T30–T33 | —                                                                                                              |
| Shared Postgres adapter base                    | 📋 E03-T40–T43 | —                                                                                                              |

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

The composition root (E03-T21) will call `checkModuleConformance`/
`assertModuleConformance` on every module it wires — including third-party
ones it never compiled against these types — so a malformed module fails
loudly at boot with every problem listed at once.

## Testing guide

```bash
pnpm --filter @corestack/platform test        # 49 tests, no Docker required
pnpm --filter @corestack/platform typecheck
```

Testing a consumer of these ports? Use the fakes under the `/testing`
subpath rather than mocking:

```ts
import { InMemoryMigrationSource } from "@corestack/platform/testing";
```

Future Postgres-backed capabilities (T02, T10+) will need Docker
(Testcontainers) and are wired into the `test:integration` lane, not `test`
— see [tooling/ci/integration-manifest.json](../../tooling/ci/integration-manifest.json).

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
| Testability     | High — 49 tests across 4 capabilities, zero Docker dependency for what exists so far                       |
| Maintainability | High — one capability, one clear layering, no cross-cutting state                                          |
| Complexity      | Low — pure functions + one small adapter; no retry/timeout machinery added without a matching failure mode |
| Documentation   | Complete for what exists (component spec + README); grows per task                                         |
| Performance     | Informal budget documented; formal benchmark pending E04-T13                                               |
| Security        | Path-traversal guard is structural (validated before path construction), not a runtime string check        |
| API stability   | Pre-publish; no consumers yet — surface may still shift before E03 exit                                    |
