import { afterEach, describe, expect, it } from "vitest";

import { ProcessEnvSource } from "../../src/infrastructure/process-env-source.js";

describe("ProcessEnvSource", () => {
  const key = "CORESTACK_PLATFORM_TEST_PROBE";

  afterEach(() => {
    delete process.env[key];
  });

  it("reads from the real process environment", () => {
    process.env[key] = "probe-value";
    expect(new ProcessEnvSource().get(key)).toBe("probe-value");
  });

  it("returns undefined for an unset variable", () => {
    expect(new ProcessEnvSource().get("CORESTACK_DEFINITELY_UNSET_VAR")).toBeUndefined();
  });
});
