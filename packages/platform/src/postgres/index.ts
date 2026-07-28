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
