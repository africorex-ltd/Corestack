import { describe, expect, it } from "vitest";
import { InMemoryEventBus, ValidationError } from "@corestack/kernel";

import { createCoreStack } from "../../src/application/create-core-stack.js";
import type { ModuleHealthStatus, ModuleInstance } from "../../src/application/module-lifecycle.js";

function fakeModule(overrides: Partial<ModuleInstance> = {}): ModuleInstance {
  return {
    useCases: {},
    eventHandlers: [],
    health: () => ({ status: "healthy" as ModuleHealthStatus }),
    ...overrides,
  };
}

describe("createCoreStack (E03-T21)", () => {
  it("boots successfully with two fake modules (task AC)", () => {
    const eventBus = new InMemoryEventBus();
    const one = fakeModule({ useCases: { ping: () => "pong-one" } });
    const two = fakeModule({ useCases: { ping: () => "pong-two" } });

    const stack = createCoreStack({ eventBus, modules: { one, two } });

    expect(stack.modules.one).toBe(one);
    expect(stack.modules.two).toBe(two);
  });

  it("subscribes every module's eventHandlers to the shared bus", async () => {
    const eventBus = new InMemoryEventBus();
    const seen: string[] = [];
    const one = fakeModule({
      eventHandlers: [{ consumer: "one", event: "a.b", handler: () => void seen.push("one") }],
    });
    const two = fakeModule({
      eventHandlers: [{ consumer: "two", event: "a.b", handler: () => void seen.push("two") }],
    });
    createCoreStack({ eventBus, modules: { one, two } });

    await eventBus.publish([
      {
        id: "e1",
        name: "a.b",
        version: 1,
        occurredAt: new Date(),
        organizationId: null,
        actor: { type: "system", id: null },
        correlationId: "c1",
        causationId: null,
        payload: {},
      },
    ]);
    expect(seen.sort()).toEqual(["one", "two"]);
  });

  it("boot-fails with an aggregated, module-namespaced message on a conformant issue", () => {
    const eventBus = new InMemoryEventBus();
    const broken = { useCases: {} } as unknown as ModuleInstance; // missing eventHandlers, health

    expect(() => createCoreStack({ eventBus, modules: { broken } })).toThrow(ValidationError);
    try {
      createCoreStack({ eventBus, modules: { broken } });
    } catch (error) {
      const validationError = error as ValidationError;
      const issues = validationError.metadata.issues as { path: string }[];
      expect(issues.map((i) => i.path).sort()).toEqual(["broken.eventHandlers", "broken.health"]);
    }
  });

  it("regression: a module missing eventHandlers fails via ValidationError, not a raw TypeError", () => {
    // Composition-level checks (duplicate consumer/event, migrations.module
    // match) assume every instance is already structurally well-formed and
    // would previously crash iterating a missing `eventHandlers` before the
    // conformance check ever got to report it.
    const eventBus = new InMemoryEventBus();
    const broken = {
      useCases: {},
      health: () => ({ status: "healthy" as const }),
    } as unknown as ModuleInstance;

    expect(() => createCoreStack({ eventBus, modules: { broken } })).not.toThrow(TypeError);
    expect(() => createCoreStack({ eventBus, modules: { broken } })).toThrow(ValidationError);
  });

  it("detects a duplicate (consumer, event) registration across two modules", () => {
    const eventBus = new InMemoryEventBus();
    const one = fakeModule({
      eventHandlers: [{ consumer: "shared", event: "a.b", handler: () => {} }],
    });
    const two = fakeModule({
      eventHandlers: [{ consumer: "shared", event: "a.b", handler: () => {} }],
    });

    expect(() => createCoreStack({ eventBus, modules: { one, two } })).toThrow(ValidationError);
    try {
      createCoreStack({ eventBus, modules: { one, two } });
    } catch (error) {
      const issues = (error as ValidationError).metadata.issues as { message: string }[];
      expect(issues[0]?.message).toMatch(/duplicate \(consumer, event\)/);
    }
  });

  it("the same consumer may subscribe to different events without collision", () => {
    const eventBus = new InMemoryEventBus();
    const one = fakeModule({
      eventHandlers: [{ consumer: "shared", event: "a.b", handler: () => {} }],
    });
    const two = fakeModule({
      eventHandlers: [{ consumer: "shared", event: "c.d", handler: () => {} }],
    });

    expect(() => createCoreStack({ eventBus, modules: { one, two } })).not.toThrow();
  });

  it("detects a migrations.module mismatch against its registration key", () => {
    const eventBus = new InMemoryEventBus();
    const mismatched = fakeModule({ migrations: { module: "wrong-name", migrations: [] } });

    expect(() => createCoreStack({ eventBus, modules: { auth: mismatched } })).toThrow(
      ValidationError,
    );
    try {
      createCoreStack({ eventBus, modules: { auth: mismatched } });
    } catch (error) {
      const issues = (error as ValidationError).metadata.issues as { message: string }[];
      expect(issues[0]?.message).toMatch(/copy-paste mistake/);
    }
  });

  it("a matching migrations.module is not flagged", () => {
    const eventBus = new InMemoryEventBus();
    const matching = fakeModule({ migrations: { module: "auth", migrations: [] } });
    expect(() => createCoreStack({ eventBus, modules: { auth: matching } })).not.toThrow();
  });

  describe("health()", () => {
    it("reports healthy when every module is healthy", async () => {
      const eventBus = new InMemoryEventBus();
      const stack = createCoreStack({
        eventBus,
        modules: { one: fakeModule(), two: fakeModule() },
      });
      expect(await stack.health()).toEqual({
        status: "healthy",
        modules: { one: { status: "healthy" }, two: { status: "healthy" } },
      });
    });

    it("worst-of aggregates: any unhealthy module makes the whole stack unhealthy", async () => {
      const eventBus = new InMemoryEventBus();
      const stack = createCoreStack({
        eventBus,
        modules: {
          one: fakeModule(),
          two: fakeModule({
            health: () => ({ status: "unhealthy", details: { reason: "db down" } }),
          }),
        },
      });
      const health = await stack.health();
      expect(health.status).toBe("unhealthy");
      expect(health.modules.two).toEqual({ status: "unhealthy", details: { reason: "db down" } });
    });

    it("degraded outranks healthy but not unhealthy", async () => {
      const eventBus = new InMemoryEventBus();
      const stack = createCoreStack({
        eventBus,
        modules: {
          one: fakeModule({ health: () => ({ status: "degraded" }) }),
          two: fakeModule(),
        },
      });
      expect((await stack.health()).status).toBe("degraded");
    });

    it("supports async health() implementations", async () => {
      const eventBus = new InMemoryEventBus();
      const stack = createCoreStack({
        eventBus,
        modules: { one: fakeModule({ health: async () => ({ status: "healthy" }) }) },
      });
      expect((await stack.health()).status).toBe("healthy");
    });
  });
});
