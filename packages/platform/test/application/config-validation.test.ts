import { describe, expect, it } from "vitest";
import { isErr, isOk, ValidationError } from "@corestack/kernel";
import { z } from "zod";

import {
  loadAllModuleConfigs,
  loadModuleConfig,
  type ModuleConfigSpec,
} from "../../src/application/config-validation.js";
import { InMemoryEnvSource } from "../../src/testing/in-memory-env-source.js";
import { InMemorySecretResolver } from "../../src/testing/in-memory-secret-resolver.js";

const authSpec: ModuleConfigSpec<{ port: number; sessionSecret: string }> = {
  moduleName: "auth",
  schema: z.object({
    port: z.coerce.number().int().positive(),
    sessionSecret: z.string().min(16),
  }),
  envMapping: {
    port: "AUTH_PORT",
    sessionSecret: { envKey: "AUTH_SESSION_SECRET", secret: true },
  },
};

describe("loadModuleConfig", () => {
  it("loads and validates a well-formed config", async () => {
    const env = new InMemoryEnvSource({
      AUTH_PORT: "3000",
      AUTH_SESSION_SECRET: "a-very-long-secret-value",
    });
    const result = await loadModuleConfig(authSpec, env);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ port: 3000, sessionSecret: "a-very-long-secret-value" });
    }
  });

  it("reports a missing required field with its field name and env key, no value", async () => {
    const env = new InMemoryEnvSource({ AUTH_SESSION_SECRET: "a-very-long-secret-value" });
    const result = await loadModuleConfig(authSpec, env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual([
        expect.objectContaining({ module: "auth", field: "port", envKey: "AUTH_PORT" }),
      ]);
    }
  });

  it("aggregates every field-level problem in one module, not just the first", async () => {
    const env = new InMemoryEnvSource({ AUTH_PORT: "not-a-number", AUTH_SESSION_SECRET: "short" });
    const result = await loadModuleConfig(authSpec, env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toHaveLength(2);
      expect(result.error.map((i) => i.field).sort()).toEqual(["port", "sessionSecret"]);
    }
  });

  it("resolves a secret field's ref: value via the provided SecretResolver", async () => {
    const env = new InMemoryEnvSource({
      AUTH_PORT: "3000",
      AUTH_SESSION_SECRET: "ref:vault:auth#session",
    });
    const resolver = new InMemorySecretResolver({
      "vault:auth#session": "resolved-secret-value-1234",
    });
    const result = await loadModuleConfig(authSpec, env, resolver);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.sessionSecret).toBe("resolved-secret-value-1234");
  });

  it("reports an issue (no value) when a ref: secret has no resolver configured", async () => {
    const env = new InMemoryEnvSource({
      AUTH_PORT: "3000",
      AUTH_SESSION_SECRET: "ref:vault:auth#session",
    });
    const result = await loadModuleConfig(authSpec, env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual([
        expect.objectContaining({
          module: "auth",
          field: "sessionSecret",
          envKey: "AUTH_SESSION_SECRET",
        }),
      ]);
      // The reference locator/value must never leak into the issue message.
      expect(JSON.stringify(result.error)).not.toContain("vault:auth#session");
    }
  });

  it("reports an issue when the resolver fails to find the referenced secret", async () => {
    const env = new InMemoryEnvSource({
      AUTH_PORT: "3000",
      AUTH_SESSION_SECRET: "ref:vault:missing",
    });
    const resolver = new InMemorySecretResolver({});
    const result = await loadModuleConfig(authSpec, env, resolver);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error[0]?.message).toMatch(/failed to resolve secret reference/);
    }
  });

  it("a non-secret field's literal value starting with ref: is used as-is, not resolved", async () => {
    const literalRefSpec: ModuleConfigSpec<{ label: string }> = {
      moduleName: "labels",
      schema: z.object({ label: z.string() }),
      envMapping: { label: "LABEL" }, // not marked secret
    };
    const env = new InMemoryEnvSource({ LABEL: "ref:this-is-just-a-literal-string" });
    const result = await loadModuleConfig(literalRefSpec, env);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.label).toBe("ref:this-is-just-a-literal-string");
  });

  it("redacts the message for a secret field even when zod's own message would echo the value", async () => {
    // z.enum's message format includes the received value verbatim — the
    // exact leak vector this framework guards against for secret fields.
    const enumSpec: ModuleConfigSpec<{ mode: "a" | "b" }> = {
      moduleName: "sensitive",
      schema: z.object({ mode: z.enum(["a", "b"]) }),
      envMapping: { mode: { envKey: "MODE", secret: true } },
    };
    const env = new InMemoryEnvSource({ MODE: "super-secret-actual-value" });
    const result = await loadModuleConfig(enumSpec, env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(JSON.stringify(result.error)).not.toContain("super-secret-actual-value");
      expect(result.error[0]?.message).toMatch(/redacted/);
    }
  });

  it("a non-secret field's invalid-enum message is left intact (no value to protect)", async () => {
    const enumSpec: ModuleConfigSpec<{ mode: "a" | "b" }> = {
      moduleName: "plain",
      schema: z.object({ mode: z.enum(["a", "b"]) }),
      envMapping: { mode: "MODE" },
    };
    const env = new InMemoryEnvSource({ MODE: "c" });
    const result = await loadModuleConfig(enumSpec, env);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error[0]?.message).not.toMatch(/redacted/);
  });
});

describe("loadAllModuleConfigs", () => {
  const billingSpec: ModuleConfigSpec<{ apiKey: string }> = {
    moduleName: "billing",
    schema: z.object({ apiKey: z.string().min(1) }),
    envMapping: { apiKey: { envKey: "BILLING_API_KEY", secret: true } },
  };

  it("resolves every module when all configs are valid", async () => {
    const env = new InMemoryEnvSource({
      AUTH_PORT: "3000",
      AUTH_SESSION_SECRET: "a-very-long-secret-value",
      BILLING_API_KEY: "sk_test_123",
    });
    const result = await loadAllModuleConfigs({ specs: [authSpec, billingSpec], env });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(Object.keys(result.value).sort()).toEqual(["auth", "billing"]);
    }
  });

  it("aggregates issues across ALL modules in one ValidationError, not just the first failing module", async () => {
    const env = new InMemoryEnvSource({}); // both modules missing everything
    const result = await loadAllModuleConfigs({ specs: [authSpec, billingSpec], env });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
      const modules = new Set(
        (result.error.metadata.issues as { module: string }[]).map((i) => i.module),
      );
      expect(modules).toEqual(new Set(["auth", "billing"]));
      expect(result.error.message).toMatch(/2 module/);
    }
  });

  it("is all-or-nothing: any failing module means no partial config is returned", async () => {
    const env = new InMemoryEnvSource({
      AUTH_PORT: "3000",
      AUTH_SESSION_SECRET: "a-very-long-secret-value",
      // billing's apiKey is missing
    });
    const result = await loadAllModuleConfigs({ specs: [authSpec, billingSpec], env });
    expect(isErr(result)).toBe(true);
  });
});
