import { z } from "zod";
import type { EnvSource, ModuleConfigSpec } from "@corestack/platform";

/**
 * Tenancy's configuration surface (E05-T01 Section 5). Scope per
 * docs/modules/tenancy-contract.md's "Configuration surface" section: the
 * blueprint only names two concrete config-bearing behaviors before E05's
 * later tasks pin down more — invitation expiry (E05-T17) and rate-limit
 * values for the public, unauthenticated invitation endpoints (E05-T25).
 * No hidden configuration: every value a command will read at runtime
 * must be declared here, not read ad hoc.
 *
 * Fields are required strings, not optional or coerced numbers.
 * `ModuleConfigSpec<T>.schema` is typed `ZodType<T>`, which fixes the
 * schema's Input *and* Output to the same `T` — empirically, under this
 * repo's `exactOptionalPropertyTypes: true`, neither `.optional()` nor
 * `z.coerce.number()` can satisfy that (confirmed with an isolated `tsc`
 * check, not assumed; recorded as a confirmed finding in
 * docs/engineering/e05-readiness-friction-log.md). `loadModuleConfig`
 * also always supplies raw env-var strings, so a string-shaped schema is
 * the only shape that is both type-correct here and truthful about what
 * arrives at runtime — matching `acme-crm-module`'s own
 * `welcomeMessage: z.string().min(1)` precedent exactly.
 *
 * Defaults therefore can't live in the schema (a required field has none,
 * an optional one breaks the type). `withTenancyConfigDefaults` supplies
 * them one layer out, at the `EnvSource`, and `resolveTenancyConfig`
 * converts the validated numeric strings into real numbers for command
 * consumption.
 */
export interface TenancyConfig {
  readonly invitationExpiryHours: string;
  readonly invitationRateLimitPerHour: string;
}

export interface ResolvedTenancyConfig {
  readonly invitationExpiryHours: number;
  readonly invitationRateLimitPerHour: number;
}

const INVITATION_EXPIRY_HOURS_ENV_KEY = "TENANCY_INVITATION_EXPIRY_HOURS";
const INVITATION_RATE_LIMIT_PER_HOUR_ENV_KEY = "TENANCY_INVITATION_RATE_LIMIT_PER_HOUR";
const POSITIVE_INTEGER_STRING = /^[1-9]\d*$/;

export const DEFAULT_TENANCY_CONFIG: ResolvedTenancyConfig = {
  invitationExpiryHours: 72,
  invitationRateLimitPerHour: 10,
};

export const tenancyConfigSpec: ModuleConfigSpec<TenancyConfig> = {
  moduleName: "tenancy",
  schema: z.object({
    invitationExpiryHours: z.string().regex(POSITIVE_INTEGER_STRING, "must be a positive integer"),
    invitationRateLimitPerHour: z
      .string()
      .regex(POSITIVE_INTEGER_STRING, "must be a positive integer"),
  }),
  envMapping: {
    invitationExpiryHours: INVITATION_EXPIRY_HOURS_ENV_KEY,
    invitationRateLimitPerHour: INVITATION_RATE_LIMIT_PER_HOUR_ENV_KEY,
  },
};

/**
 * Wraps an `EnvSource` so `TENANCY_INVITATION_EXPIRY_HOURS` /
 * `TENANCY_INVITATION_RATE_LIMIT_PER_HOUR` fall back to
 * `DEFAULT_TENANCY_CONFIG` when the operator hasn't set them — the
 * composition root passes `withTenancyConfigDefaults(env)` to
 * `loadModuleConfig`/`loadAllModuleConfigs` instead of `env` directly.
 */
export function withTenancyConfigDefaults(env: EnvSource): EnvSource {
  return {
    get(key: string): string | undefined {
      const value = env.get(key);
      if (value !== undefined) return value;
      if (key === INVITATION_EXPIRY_HOURS_ENV_KEY) {
        return String(DEFAULT_TENANCY_CONFIG.invitationExpiryHours);
      }
      if (key === INVITATION_RATE_LIMIT_PER_HOUR_ENV_KEY) {
        return String(DEFAULT_TENANCY_CONFIG.invitationRateLimitPerHour);
      }
      return undefined;
    },
  };
}

/** Converts the schema's validated numeric-string fields into real numbers. */
export function resolveTenancyConfig(config: TenancyConfig): ResolvedTenancyConfig {
  return {
    invitationExpiryHours: Number(config.invitationExpiryHours),
    invitationRateLimitPerHour: Number(config.invitationRateLimitPerHour),
  };
}
