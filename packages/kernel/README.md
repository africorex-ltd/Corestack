# @corestack/kernel

Shared building blocks for every CoreStack module. The kernel deliberately contains
**only cross-cutting mechanics with no business meaning**:

- **`Result<T, E>`** — explicit, typed handling of expected failures. Use cases
  return `Result`; unexpected failures throw.
- **`CoreError` taxonomy** — `ValidationError`, `NotFoundError`, `ConflictError`,
  `UnauthorizedError`, `ForbiddenError`, each with a stable machine-readable `code`
  that interface layers map to transport responses.
- **`Clock` port** — `SystemClock` for production, `FixedClock` for deterministic
  tests. Domain code never calls `Date.now()` directly.
- **`IdGenerator` port** — `UuidGenerator` (WebCrypto, runtime-agnostic) for
  production, `SequentialIdGenerator` for tests.

## Usage

```ts
import { ok, err, type Result, NotFoundError, type Clock } from "@corestack/kernel";

class GetUser {
  constructor(
    private readonly users: UserRepository,
    private readonly clock: Clock,
  ) {}

  async execute(id: string): Promise<Result<UserDto, NotFoundError>> {
    const user = await this.users.findById(id);
    if (!user) return err(new NotFoundError(`user ${id} not found`));
    return ok(toDto(user, this.clock.now()));
  }
}
```

## Design constraints

- Zero runtime dependencies, no Node builtins — runs anywhere ES2022 does.
- If a candidate addition has business meaning, it belongs in a module, not here.
