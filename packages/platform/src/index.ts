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
