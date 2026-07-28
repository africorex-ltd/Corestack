import { describe, expect, it } from "vitest";
import { FixedClock, SequentialIdGenerator, ValidationError } from "@corestack/kernel";

import {
  assertModuleConformance,
  checkModuleConformance,
} from "../../src/application/module-lifecycle.js";
import { createFixtureModule } from "./fixtures/fixture-module.js";

function buildFixtureInstance() {
  return createFixtureModule(
    {
      clock: new FixedClock(new Date("2026-07-28T00:00:00Z")),
      ids: new SequentialIdGenerator("fx-"),
    },
    { greeting: "hello" },
  );
}

describe("module lifecycle: ModuleFactory type + conformance checker (E03-T20)", () => {
  it("a real factory built from kernel ports conforms with zero issues", () => {
    const instance = buildFixtureInstance();
    expect(checkModuleConformance(instance)).toEqual([]);
    expect(() => assertModuleConformance(instance, "fixture")).not.toThrow();
  });

  it("the factory's use cases and event handlers actually work", () => {
    const instance = buildFixtureInstance();
    expect(instance.useCases.ping()).toBe("hello fx-1");
    expect(instance.useCases.now().toISOString()).toBe("2026-07-28T00:00:00.000Z");
    expect(instance.eventHandlers).toHaveLength(1);
    expect(instance.eventHandlers[0]?.consumer).toBe("fixture");
  });

  it("a non-object instance yields a single top-level issue", () => {
    expect(checkModuleConformance(null)).toEqual([{ path: "$", message: expect.any(String) }]);
    expect(checkModuleConformance("not a module")).toEqual([
      { path: "$", message: expect.any(String) },
    ]);
  });

  it("flags every missing required field, aggregated", () => {
    const issues = checkModuleConformance({});
    expect(issues.map((i) => i.path).sort()).toEqual(["eventHandlers", "health", "useCases"]);
  });

  it("flags each malformed event subscription field individually", () => {
    const issues = checkModuleConformance({
      useCases: {},
      eventHandlers: [{ consumer: "", event: 123, handler: "not-a-function" }],
      health: () => ({ status: "healthy" }),
    });
    expect(issues.map((i) => i.path).sort()).toEqual([
      "eventHandlers[0].consumer",
      "eventHandlers[0].event",
      "eventHandlers[0].handler",
    ]);
  });

  it("a non-object event subscription entry is flagged as a whole", () => {
    const issues = checkModuleConformance({
      useCases: {},
      eventHandlers: [null],
      health: () => ({ status: "healthy" }),
    });
    expect(issues).toEqual([{ path: "eventHandlers[0]", message: expect.any(String) }]);
  });

  it("accepts a module with a well-formed optional migrations set", () => {
    const instance = {
      useCases: {},
      eventHandlers: [],
      migrations: { module: "fixture", migrations: [] },
      health: () => ({ status: "healthy" }),
    };
    expect(checkModuleConformance(instance)).toEqual([]);
  });

  it("rejects a malformed migrations value", () => {
    const issues = checkModuleConformance({
      useCases: {},
      eventHandlers: [],
      migrations: { wrong: "shape" },
      health: () => ({ status: "healthy" }),
    });
    expect(issues).toEqual([{ path: "migrations", message: expect.any(String) }]);
  });

  it("omitting migrations entirely is valid (it is optional)", () => {
    const issues = checkModuleConformance({
      useCases: {},
      eventHandlers: [],
      health: () => ({ status: "healthy" }),
    });
    expect(issues).toEqual([]);
  });

  it("assertModuleConformance throws ValidationError with every issue in metadata", () => {
    try {
      assertModuleConformance({}, "broken-module");
      expect.unreachable("expected assertModuleConformance to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.metadata.module).toBe("broken-module");
      expect(validationError.metadata.issues).toHaveLength(3);
    }
  });
});
