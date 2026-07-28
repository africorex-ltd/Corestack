/**
 * Config validation framework (E03-T22; Architecture §8, §22).
 *
 * Every module declares a `ModuleConfigSpec`: a Zod schema over its
 * (flat) config shape, plus a mapping from schema field names to the env
 * vars that supply them. `loadAllModuleConfigs` validates every module's
 * config and reports **every** problem across **every** module in one
 * aggregated failure — never fail-fast on the first module or field — so
 * an operator fixes a broken deployment in one pass instead of a
 * restart-and-see-the-next-error loop.
 *
 * Scope, deliberately: config sources are flat env-var-keyed values (env
 * vars are inherently flat; nested config is a module's own concern to
 * post-process if it truly needs one). This framework does not invent a
 * config file format, only an env-to-schema mapping.
 *
 * Secrets: a field marked `secret: true` may supply its value either as a
 * literal or as a `ref:...` indirection (domain layer) resolved via a
 * `SecretResolver`. **No config value ever appears in a validation issue**
 * — issues describe what rule failed (missing, wrong type, wrong format),
 * never the value that failed it — which trivially satisfies "secrets
 * never in error output" by never echoing *any* value, secret or not.
 */

import { ValidationError, err, ok, type Result } from "@corestack/kernel";
import type { ZodType } from "zod";

import { SECRET_REF_PREFIX, isSecretRefValue, stripSecretRefPrefix } from "../domain/secret-ref.js";

export interface EnvSource {
  get(key: string): string | undefined;
}

export interface SecretResolver {
  resolve(ref: string): Promise<string>;
}

export type ModuleConfigFieldMapping =
  string | { readonly envKey: string; readonly secret?: boolean };

export type ModuleConfigEnvMapping = Readonly<Record<string, ModuleConfigFieldMapping>>;

export interface ModuleConfigSpec<T> {
  readonly moduleName: string;
  readonly schema: ZodType<T>;
  readonly envMapping: ModuleConfigEnvMapping;
}

export interface ConfigValidationIssue {
  readonly module: string;
  readonly field: string;
  readonly envKey?: string;
  readonly message: string;
}

function envKeyOf(mapping: ModuleConfigFieldMapping): string {
  return typeof mapping === "string" ? mapping : mapping.envKey;
}

function isSecretField(mapping: ModuleConfigFieldMapping): boolean {
  return typeof mapping === "string" ? false : Boolean(mapping.secret);
}

function envKeyForField(
  spec: ModuleConfigSpec<unknown>,
  field: string | undefined,
): string | undefined {
  if (field === undefined) return undefined;
  const mapping = spec.envMapping[field];
  return mapping === undefined ? undefined : envKeyOf(mapping);
}

/** Load and validate exactly one module's config. */
export async function loadModuleConfig<T>(
  spec: ModuleConfigSpec<T>,
  env: EnvSource,
  secretResolver?: SecretResolver,
): Promise<Result<T, ConfigValidationIssue[]>> {
  const raw: Record<string, unknown> = {};
  const resolutionIssues: ConfigValidationIssue[] = [];

  for (const [field, mapping] of Object.entries(spec.envMapping)) {
    const envKey = envKeyOf(mapping);
    const secret = isSecretField(mapping);
    const value = env.get(envKey);
    if (value === undefined) continue; // let the schema decide if it's required

    if (!secret || !isSecretRefValue(value)) {
      // ref: syntax is honored only on declared-secret fields — a
      // non-secret field's value is always used literally, even if it
      // happens to start with "ref:".
      raw[field] = value;
      continue;
    }

    if (secretResolver === undefined) {
      resolutionIssues.push({
        module: spec.moduleName,
        field,
        envKey,
        message: `references a secret ("${SECRET_REF_PREFIX}...") but no SecretResolver was configured`,
      });
      continue;
    }

    try {
      raw[field] = await secretResolver.resolve(stripSecretRefPrefix(value));
    } catch (error) {
      resolutionIssues.push({
        module: spec.moduleName,
        field,
        envKey,
        message: `failed to resolve secret reference: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }

  // A field whose secret resolution already failed above is missing from
  // `raw` for that reason, not because the operator omitted it — the schema
  // would otherwise ALSO flag it as missing/invalid, producing two issues
  // for one root cause. Suppress the schema-level echo for those fields.
  const fieldsWithResolutionIssues = new Set(resolutionIssues.map((issue) => issue.field));

  const parsed = spec.schema.safeParse(raw);
  const schemaIssues: ConfigValidationIssue[] = parsed.success
    ? []
    : parsed.error.issues
        .filter((issue) => {
          const firstSegment = issue.path[0] === undefined ? undefined : String(issue.path[0]);
          return firstSegment === undefined || !fieldsWithResolutionIssues.has(firstSegment);
        })
        .map((issue) => {
          const field = issue.path.length > 0 ? issue.path.join(".") : "(root)";
          const firstSegment = issue.path[0] === undefined ? undefined : String(issue.path[0]);
          const mapping = firstSegment === undefined ? undefined : spec.envMapping[firstSegment];
          const envKey = envKeyForField(spec, firstSegment);
          // Zod's own issue messages can echo the received value (e.g.
          // enum/literal mismatches: "received 'x'") — for a secret field
          // that would leak the value through the message text even
          // though this framework never passes values through explicitly.
          // Redact instead of trusting the upstream message.
          const message =
            mapping !== undefined && isSecretField(mapping)
              ? "value is invalid (message redacted: this field is marked secret)"
              : issue.message;
          // exactOptionalPropertyTypes: omit envKey entirely rather than
          // set it to undefined — the two are not the same thing here.
          return envKey === undefined
            ? { module: spec.moduleName, field, message }
            : { module: spec.moduleName, field, envKey, message };
        });

  const allIssues = [...resolutionIssues, ...schemaIssues];
  if (allIssues.length > 0) return err(allIssues);
  return ok((parsed as { success: true; data: T }).data);
}

export interface LoadAllModuleConfigsInput {
  readonly specs: readonly ModuleConfigSpec<unknown>[];
  readonly env: EnvSource;
  readonly secretResolver?: SecretResolver;
}

/**
 * Validate every module's config together; on any failure, return one
 * `ValidationError` whose `metadata.issues` lists every problem across
 * every module — the fail-fast-per-field aggregate report the whole
 * platform standardizes on.
 */
export async function loadAllModuleConfigs(
  input: LoadAllModuleConfigsInput,
): Promise<Result<Readonly<Record<string, unknown>>, ValidationError>> {
  const resolved: Record<string, unknown> = {};
  const allIssues: ConfigValidationIssue[] = [];

  for (const spec of input.specs) {
    const result = await loadModuleConfig(spec, input.env, input.secretResolver);
    if (result.ok) {
      resolved[spec.moduleName] = result.value;
    } else {
      allIssues.push(...result.error);
    }
  }

  if (allIssues.length > 0) {
    const affectedModules = new Set(allIssues.map((issue) => issue.module)).size;
    return err(
      new ValidationError(`configuration is invalid for ${affectedModules} module(s)`, {
        metadata: { issues: allIssues },
      }),
    );
  }

  return ok(resolved);
}
