import { describe, expect, it } from "vitest";
import { CaptureLogger } from "@corestack/kernel";

import { shutdownGracefully, type Drainable } from "../../src/application/graceful-shutdown.js";

function fakeDrainable(name: string, overrides: Partial<Drainable> = {}): Drainable {
  return {
    name,
    stopIntake: async () => {},
    drain: async () => {},
    ...overrides,
  };
}

describe("shutdownGracefully (E03-T24)", () => {
  it("drains every component and reports a clean outcome", async () => {
    const report = await shutdownGracefully({
      drainables: [fakeDrainable("a"), fakeDrainable("b")],
      drainTimeoutMs: 1000,
    });
    expect(report.clean).toBe(true);
    expect(report.outcomes).toEqual([
      { name: "a", outcome: "drained" },
      { name: "b", outcome: "drained" },
    ]);
  });

  it("drains in strict registration order — earlier finishes before later starts (task AC)", async () => {
    const events: string[] = [];
    const one = fakeDrainable("one", {
      drain: async () => {
        events.push("one:start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push("one:end");
      },
    });
    const two = fakeDrainable("two", {
      drain: async () => {
        events.push("two:start");
        events.push("two:end");
      },
    });

    await shutdownGracefully({ drainables: [one, two], drainTimeoutMs: 1000 });
    expect(events).toEqual(["one:start", "one:end", "two:start", "two:end"]);
  });

  it("every stopIntake runs before any drain begins", async () => {
    const events: string[] = [];
    const one = fakeDrainable("one", {
      stopIntake: async () => void events.push("one:stopIntake"),
      drain: async () => void events.push("one:drain"),
    });
    const two = fakeDrainable("two", {
      stopIntake: async () => void events.push("two:stopIntake"),
      drain: async () => void events.push("two:drain"),
    });

    await shutdownGracefully({ drainables: [one, two], drainTimeoutMs: 1000 });
    expect(events).toEqual(["one:stopIntake", "two:stopIntake", "one:drain", "two:drain"]);
  });

  it("bounds a stuck drain by timeout and continues to the next component (task AC)", async () => {
    const events: string[] = [];
    const stuck = fakeDrainable("stuck", {
      drain: () => new Promise(() => {}), // never resolves
    });
    const after = fakeDrainable("after", { drain: async () => void events.push("after:drained") });

    const report = await shutdownGracefully({
      drainables: [stuck, after],
      drainTimeoutMs: 20,
    });

    expect(report.clean).toBe(false);
    expect(report.outcomes).toEqual([
      { name: "stuck", outcome: "timed_out" },
      { name: "after", outcome: "drained" },
    ]);
    expect(events).toEqual(["after:drained"]);
  });

  it("captures a thrown drain error without throwing itself, and continues", async () => {
    const boom = new Error("pool already closed");
    const failing = fakeDrainable("failing", {
      drain: async () => {
        throw boom;
      },
    });
    const after = fakeDrainable("after");

    const report = await shutdownGracefully({ drainables: [failing, after], drainTimeoutMs: 1000 });
    expect(report.clean).toBe(false);
    expect(report.outcomes).toEqual([
      { name: "failing", outcome: "failed", error: boom },
      { name: "after", outcome: "drained" },
    ]);
  });

  it("a failing stopIntake is logged but never blocks draining", async () => {
    const logger = new CaptureLogger();
    const flaky = fakeDrainable("flaky", {
      stopIntake: async () => {
        throw new Error("already unbound");
      },
    });

    const report = await shutdownGracefully({ drainables: [flaky], drainTimeoutMs: 1000, logger });
    expect(report.clean).toBe(true);
    expect(logger.entries.some((e) => e.level === "warn" && e.message.includes("stopIntake"))).toBe(
      true,
    );
  });

  it("never throws — even with no logger and every component failing", async () => {
    const allBad = fakeDrainable("bad", {
      stopIntake: async () => {
        throw new Error("x");
      },
      drain: async () => {
        throw new Error("y");
      },
    });
    await expect(
      shutdownGracefully({ drainables: [allBad], drainTimeoutMs: 1000 }),
    ).resolves.toBeDefined();
  });

  it("an empty drainable list is a trivially clean shutdown", async () => {
    const report = await shutdownGracefully({ drainables: [], drainTimeoutMs: 1000 });
    expect(report).toEqual({ outcomes: [], clean: true });
  });
});
