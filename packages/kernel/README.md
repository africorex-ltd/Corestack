# @corestack/kernel

> **Status: Release Candidate** —
> [certification report](../../docs/quality/certifications/kernel-0.2.0-rc.md)
> (2026-07-28). Publish awaits npm credentials.

Shared building blocks for every CoreStack module. The kernel deliberately
contains **only cross-cutting mechanics with no business meaning**, has **zero
runtime dependencies**, and compiles against the pure ES2022 lib — no Node or
DOM types — so it runs on any modern runtime (ADR-0001).

## Surface

| Area                 | Exports                                                                                                                          | Purpose                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Results              | `Result`, `ok/err`, `map/mapErr/andThen`, `all`, `fromPromise`, `mapAsync/andThenAsync`, `unwrapOr/unwrapOrThrow`                | Expected failures are values; unexpected failures throw (Architecture §3)               |
| Errors               | `CoreError` + `Validation/NotFound/Conflict/Unauthorized/Forbidden/RateLimited/PayloadTooLarge/PreconditionFailed/CryptoFailure` | Stable `core/*` codes — the registry interface layers map to transports                 |
| Context              | `Context`, `Actor`, `createContext`, `systemContext`, `causedBy`                                                                 | The correlation spine: actor + org scope + correlation/causation ids (Architecture §32) |
| Events               | `DomainEvent`, `createEvent`, `serializeEvent/deserializeEvent`                                                                  | Versioned, JSON-round-trippable envelope; validated names (`tenancy.member.removed`)    |
| Event bus            | `EventBus` port, `InMemoryEventBus`                                                                                              | Normative delivery semantics in TSDoc; reliability lives in the outbox (ADR-0009)       |
| Unit of work         | `UnitOfWork` port, `TransactionContext`, `InMemoryUnitOfWork`                                                                    | One transaction per use case; staged events dispatch after commit, discard on failure   |
| Idempotent consumers | `ProcessedEventStore`, `idempotentHandler`, in-memory store                                                                      | At-least-once consumers dedupe by event id; real adapters mark atomically with effects  |
| Logging              | `Logger` port, `NoopLogger`, `CaptureLogger`, `SENSITIVE_LOG_KEYS`                                                               | Structured, child-context logging; the redaction deny-list shared with lint             |
| Cache                | `Cache` port, `versionedKey`, `InMemoryLruCache`                                                                                 | Opt-in caching with invalidation-by-versioning (Architecture §12)                       |
| Rate limiting        | `RateLimiter` port, `InMemoryRateLimiter`                                                                                        | Fixed-window, caller-owned policy, transport-independent enforcement                    |
| Encryption           | `Encrypter` port, `WebCryptoAesGcmEncrypter`                                                                                     | Use-again secrets only (TOTP seeds, signing secrets); AES-256-GCM, key-id rotation      |
| Request idempotency  | `IdempotencyStore` port, `InMemoryIdempotencyStore`                                                                              | begin/complete lifecycle for `Idempotency-Key` request replay (Architecture §26)        |
| Time & ids           | `Clock` (`System/Fixed`), `IdGenerator` (`UuidGenerator` **v7**, `SequentialIdGenerator`)                                        | Ambient effects behind ports; UUIDv7 for index-friendly ordered ids (DB rule 2)         |

## Conventions

- Every in-memory implementation is the **reference semantics** its
  contract-test suite (E04) encodes; durable adapters must match it.
- The runtime export surface is snapshot-gated
  (`test/api-surface.test.ts`) — changing it is an explicit, reviewable act.
- If a candidate addition has business meaning, it belongs in a module, not
  here.

## Usage sketch

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
