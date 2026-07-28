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
