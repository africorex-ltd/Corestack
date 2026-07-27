# tooling/

Shared development configuration as **workspace packages** — versioned and
reviewed like code, because config drift is code drift
([10-repository-structure.md](../docs/engineering/10-repository-structure.md) §1).

| Package                             | Purpose                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@corestack/tsconfig`               | TypeScript presets: `base` (strictness, single source), `library`, `app`                                         |
| `@corestack/eslint-config`          | Flat config incl. Clean Architecture layer-boundary rules (Architecture §4)                                      |
| `@corestack/prettier-config`        | Shared Prettier config, consumed via the root `"prettier"` field                                                 |
| `@corestack/scripts`                | Repo automation (dependency-free Node): `check-single-version.mjs` (E01-T01); issue seeding arrives with E01-T04 |
| `contract-kit` _(arrives with E04)_ | Port contract-test suites, Testcontainers harness, fakes                                                         |

All private (`privatePackages` in Changesets — never published).
