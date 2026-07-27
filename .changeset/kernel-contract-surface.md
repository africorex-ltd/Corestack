---
"@corestack/kernel": minor
---

Complete the kernel contract surface: `Context` with correlation/causation, the versioned domain-event envelope with JSON serialization, the `EventBus` port with normative delivery semantics (+ in-memory bus), `Logger` port with `SENSITIVE_LOG_KEYS`, `Cache` port with versioned-key invalidation (+ LRU reference), fixed-window `RateLimiter`, `Encrypter` port with AES-256-GCM WebCrypto reference and key rotation, `UnitOfWork` with after-commit event dispatch, idempotent-consumer support, four new error codes (`core/rate_limited`, `core/payload_too_large`, `core/precondition_failed`, `core/crypto_failure`), Result async/combinator utilities, and UUID**v7** ids — the generated id format changes from v4 to v7 (time-ordered).
