/**
 * `@corestack/platform/postgres` — the reference Postgres adapters.
 * Subpath export (ADR-0010, Architecture §45/§7): `postgres` is an
 * optional peer dependency, installed only by adopters who import from
 * this path — the main `.` entry point never pulls it in.
 */

export {
  PostgresMigrationRunnerStore,
  ensureMigrationTrackingSchema,
} from "../infrastructure/postgres-migration-runner-store.js";

export { ensurePlatformSchema } from "../infrastructure/ensure-platform-schema.js";

export type { EnsureOutboxSchemaOptions } from "../infrastructure/postgres-outbox-schema.js";
export { ensureOutboxSchema } from "../infrastructure/postgres-outbox-schema.js";

export type { OutboxStaging } from "../infrastructure/postgres-outbox-writer.js";
export {
  writeOutboxEvents,
  createOutboxStaging,
} from "../infrastructure/postgres-outbox-writer.js";

export { PostgresOutboxRelayStore } from "../infrastructure/postgres-outbox-relay-store.js";

export { PostgresProcessedEventStore } from "../infrastructure/postgres-processed-event-store.js";

export type {
  MaintainOutboxPartitionsOptions,
  OutboxPartitionMaintenanceReport,
} from "../infrastructure/postgres-outbox-partition-maintenance.js";
export { maintainOutboxPartitions } from "../infrastructure/postgres-outbox-partition-maintenance.js";

export {
  PostgresDatabasePing,
  PostgresMigrationsStatus,
} from "../infrastructure/postgres-health-checks.js";

export type { TenancyRoleNames } from "../infrastructure/postgres-tenancy-roles.js";
export { ensureTenancyRoles } from "../infrastructure/postgres-tenancy-roles.js";

export { withOrgContext } from "../infrastructure/postgres-org-context.js";

export { runOrgScopedQuery } from "../infrastructure/postgres-org-scoped-repository.js";

export type { PostgresTransactionContext } from "../infrastructure/postgres-unit-of-work.js";
export { PostgresUnitOfWork } from "../infrastructure/postgres-unit-of-work.js";

export { ensureRateLimitsSchema } from "../infrastructure/postgres-rate-limiter-schema.js";
export {
  PostgresRateLimiter,
  pruneRateLimitWindows,
} from "../infrastructure/postgres-rate-limiter.js";

export { ensureIdempotencyKeysSchema } from "../infrastructure/postgres-idempotency-store-schema.js";
export {
  PostgresIdempotencyStore,
  pruneIdempotencyKeys,
} from "../infrastructure/postgres-idempotency-store.js";
