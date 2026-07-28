/**
 * `@corestack/platform/testing` — fakes for adopters and contributors
 * testing code that depends on platform ports, without pulling test-only
 * code into the production bundle (Architecture §45/§7 subpath convention).
 */

export { InMemoryMigrationSource } from "./in-memory-migration-source.js";
export { InMemoryEnvSource } from "./in-memory-env-source.js";
export { InMemorySecretResolver } from "./in-memory-secret-resolver.js";
export { InMemoryMembershipLookup } from "./in-memory-membership-lookup.js";
export { InMemoryMigrationRunnerStore } from "./in-memory-migration-runner-store.js";
