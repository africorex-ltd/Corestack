export type { LockImpact, MigrationHeader, MigrationFile } from "./domain/migration-file.js";
export {
  assertValidModuleName,
  parseMigrationVersion,
  parseMigrationHeader,
  computeChecksum,
  parseMigrationFile,
} from "./domain/migration-file.js";

export type { RawMigrationFile, MigrationSource } from "./application/migration-source.js";
export type { MigrationSet } from "./application/load-migration-set.js";
export { loadMigrationSet } from "./application/load-migration-set.js";

export type { FsMigrationSourceOptions } from "./infrastructure/fs-migration-source.js";
export { FsMigrationSource } from "./infrastructure/fs-migration-source.js";

export type {
  ModuleHealthStatus,
  ModuleHealth,
  ModuleInstance,
  ModuleFactory,
  ModuleConformanceIssue,
} from "./application/module-lifecycle.js";
export { checkModuleConformance, assertModuleConformance } from "./application/module-lifecycle.js";

export { SECRET_REF_PREFIX, isSecretRefValue, stripSecretRefPrefix } from "./domain/secret-ref.js";

export type {
  EnvSource,
  SecretResolver,
  ModuleConfigFieldMapping,
  ModuleConfigEnvMapping,
  ModuleConfigSpec,
  ConfigValidationIssue,
  LoadAllModuleConfigsInput,
} from "./application/config-validation.js";
export { loadModuleConfig, loadAllModuleConfigs } from "./application/config-validation.js";

export { ProcessEnvSource } from "./infrastructure/process-env-source.js";

export type {
  CreateCoreStackOptions,
  CoreStackHealth,
  CoreStack,
} from "./application/create-core-stack.js";
export { createCoreStack } from "./application/create-core-stack.js";

export type {
  Drainable,
  GracefulShutdownOptions,
  ShutdownOutcome,
  ShutdownReport,
} from "./application/graceful-shutdown.js";
export { shutdownGracefully } from "./application/graceful-shutdown.js";

export type { MembershipLookup, ResolveContextInput } from "./application/resolve-context.js";
export { resolveContext } from "./application/resolve-context.js";

export { computeChainChecksum, computeAdvisoryLockKey } from "./domain/chain-checksum.js";

export type { PartitionBounds } from "./domain/outbox-partition.js";
export { computeMonthlyPartitionBounds, partitionUpperBound } from "./domain/outbox-partition.js";

export type { ExistingPartition, PartitionDropPlan } from "./domain/outbox-partition-retention.js";
export { planPartitionDrops } from "./domain/outbox-partition-retention.js";

export { assertSafeSqlIdentifier } from "./domain/sql-identifier.js";

export type { OutboxEventRow, OutboxTableRow } from "./domain/outbox-event.js";
export { toOutboxRow, fromOutboxRow } from "./domain/outbox-event.js";

export type {
  RelayCursor,
  OutboxRelayStore,
  OutboxRelayOptions,
} from "./application/outbox-relay.js";
export { OutboxRelay } from "./application/outbox-relay.js";

export type {
  ModuleMigrationState,
  MigrationRunnerStore,
  MigrationRunResult,
} from "./application/migration-runner.js";
export { runMigrations } from "./application/migration-runner.js";

export type { CheckStatus, ReadinessLevel } from "./domain/health.js";
export {
  worstCheckStatus,
  worstReadinessLevel,
  checkStatusToReadinessLevel,
  moduleHealthStatusToReadinessLevel,
} from "./domain/health.js";

export type {
  LivenessResult,
  DatabasePingPort,
  MigrationsStatusPort,
  RelayLagReading,
  RelayLagThresholds,
  RelayLagConsumerResult,
  RelayLagCheckResult,
  BacklogCheckPort,
  BacklogThresholds,
  BacklogConsumerResult,
  BacklogCheckResult,
  DatabaseCheckResult,
  ClockSkewCheckResult,
  MigrationsCheckResult,
  ReadinessThresholds,
  ReadinessDeps,
  ReadinessResult,
} from "./application/health-readiness.js";
export { checkLiveness, checkReadiness, RelayLagRecorder } from "./application/health-readiness.js";

export type { TenantPolicyTarget } from "./domain/tenant-policy.js";
export { buildTenantIsolationDdl } from "./domain/tenant-policy.js";

export type { OrgScopedContext } from "./application/org-scoped-context.js";
export { requireOrgScoped } from "./application/org-scoped-context.js";

export type { PurgeHandler } from "./application/purge-protocol.js";
export {
  ORGANIZATION_PURGE_REQUESTED_EVENT,
  registerPurgeHandler,
} from "./application/purge-protocol.js";
