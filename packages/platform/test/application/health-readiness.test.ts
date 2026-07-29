import { FixedClock } from "@corestack/kernel";
import { describe, expect, it } from "vitest";

import {
  checkLiveness,
  checkReadiness,
  RelayLagRecorder,
  type BacklogCheckPort,
  type DatabasePingPort,
  type MigrationsStatusPort,
  type ReadinessDeps,
} from "../../src/application/health-readiness.js";
import type { CoreStack, CoreStackHealth } from "../../src/application/create-core-stack.js";

const NOW = new Date("2026-07-29T00:00:00Z");

function baseDeps(overrides: Partial<ReadinessDeps> = {}): ReadinessDeps {
  const clock = new FixedClock(NOW);
  const database: DatabasePingPort = {
    ping: async () => ({ latencyMs: 1 }),
    now: async () => NOW,
  };
  const migrations: MigrationsStatusPort = {
    appliedVersions: async () => new Map(),
  };
  return {
    clock,
    database,
    migrations,
    expectedVersions: new Map(),
    thresholds: {
      databaseLatencyDegradedMs: 100,
      clockSkewDegradedMs: 1000,
      clockSkewUnreadyMs: 5000,
    },
    ...overrides,
  };
}

describe("checkLiveness", () => {
  it("returns live status with the clock's current time, no dependency checks", () => {
    const result = checkLiveness(new FixedClock(NOW));
    expect(result).toEqual({ status: "live", timestamp: NOW.toISOString() });
  });
});

describe("checkReadiness — database and clock skew", () => {
  it("is fully ready when everything is healthy", async () => {
    const result = await checkReadiness(baseDeps());
    expect(result.status).toBe("ready");
    expect(result.checks.database).toEqual({ status: "ok", latencyMs: 1 });
    expect(result.checks.clockSkew).toEqual({ status: "ok", skewMs: 0 });
    expect(result.checks.migrations).toEqual({ status: "ok", pendingCount: 0 });
  });

  it("marks database degraded when latency exceeds the threshold, but stays ready overall only if nothing else fails", async () => {
    const deps = baseDeps({
      database: { ping: async () => ({ latencyMs: 500 }), now: async () => NOW },
    });
    const result = await checkReadiness(deps);
    expect(result.checks.database).toEqual({ status: "degraded", latencyMs: 500 });
    expect(result.status).toBe("degraded");
  });

  it("marks database failing when ping throws, and clock skew failing too since it can't be measured", async () => {
    const deps = baseDeps({
      database: {
        ping: async () => {
          throw new Error("connection refused");
        },
        now: async () => NOW,
      },
    });
    const result = await checkReadiness(deps);
    expect(result.checks.database).toEqual({ status: "failing" });
    expect(result.checks.clockSkew).toEqual({ status: "failing" });
    expect(result.status).toBe("unready");
  });

  it("computes clock skew from the absolute difference between local and database clocks", async () => {
    const dbNow = new Date(NOW.getTime() + 2000); // 2s ahead
    const deps = baseDeps({
      database: { ping: async () => ({ latencyMs: 1 }), now: async () => dbNow },
    });
    const result = await checkReadiness(deps);
    expect(result.checks.clockSkew).toEqual({ status: "degraded", skewMs: 2000 });
  });

  it("marks clock skew failing once it exceeds the unready threshold", async () => {
    const dbNow = new Date(NOW.getTime() + 10_000);
    const deps = baseDeps({
      database: { ping: async () => ({ latencyMs: 1 }), now: async () => dbNow },
    });
    const result = await checkReadiness(deps);
    expect(result.checks.clockSkew.status).toBe("failing");
    expect(result.status).toBe("unready");
  });
});

describe("checkReadiness — migrations", () => {
  it("reports pending modules and fails readiness when applied version is behind expected", async () => {
    const deps = baseDeps({
      migrations: { appliedVersions: async () => new Map([["tenancy", 2]]) },
      expectedVersions: new Map([
        ["tenancy", 3],
        ["billing", 1],
      ]),
    });
    const result = await checkReadiness(deps);
    expect(result.checks.migrations.status).toBe("failing");
    expect(result.checks.migrations.pendingCount).toBe(2);
    expect(result.checks.migrations.pendingModules).toEqual(
      expect.arrayContaining(["tenancy", "billing"]),
    );
    expect(result.status).toBe("unready");
  });

  it("treats a module with no applied-version row as version 0 (fully pending)", async () => {
    const deps = baseDeps({
      migrations: { appliedVersions: async () => new Map() },
      expectedVersions: new Map([["tenancy", 1]]),
    });
    const result = await checkReadiness(deps);
    expect(result.checks.migrations.pendingModules).toEqual(["tenancy"]);
  });

  it("fails migrations status when the status query itself throws", async () => {
    const deps = baseDeps({
      migrations: {
        appliedVersions: async () => {
          throw new Error("db error");
        },
      },
    });
    const result = await checkReadiness(deps);
    expect(result.checks.migrations.status).toBe("failing");
  });
});

describe("checkReadiness — relay lag", () => {
  it("is omitted from the response when not configured", async () => {
    const result = await checkReadiness(baseDeps());
    expect(result.checks.relayLag).toBeUndefined();
  });

  it("reports ok/degraded/unready per consumer against the given thresholds", async () => {
    const recorder = new RelayLagRecorder(new FixedClock(NOW));
    recorder.record("audit", 100);
    recorder.record("billing", 40_000);
    recorder.record("reporting", 400_000);

    const deps = baseDeps({
      relayLag: {
        recorder,
        thresholds: { degradedMs: 30_000, unreadyMs: 300_000, staleAfterMs: 600_000 },
      },
    });
    const result = await checkReadiness(deps);
    expect(result.checks.relayLag?.consumers.audit?.status).toBe("ok");
    expect(result.checks.relayLag?.consumers.billing?.status).toBe("degraded");
    expect(result.checks.relayLag?.consumers.reporting?.status).toBe("failing");
  });

  it("treats a stale reading as failing even when its own lagMs looked fine at the time", async () => {
    const clock = new FixedClock(NOW);
    const recorder = new RelayLagRecorder(clock);
    recorder.record("audit", 10);

    // Advance the clock used for evaluation, simulating a relay that
    // stopped polling long after its last (healthy-looking) reading.
    const laterClock = new FixedClock(new Date(NOW.getTime() + 700_000));
    const deps = baseDeps({
      clock: laterClock,
      relayLag: {
        recorder,
        thresholds: { degradedMs: 30_000, unreadyMs: 300_000, staleAfterMs: 600_000 },
      },
    });
    const result = await checkReadiness(deps);
    expect(result.checks.relayLag?.consumers.audit?.status).toBe("failing");
    expect(result.status).toBe("unready");
  });
});

describe("checkReadiness — backlog", () => {
  it("is omitted from the response when not configured", async () => {
    const result = await checkReadiness(baseDeps());
    expect(result.checks.backlog).toBeUndefined();
  });

  it("reports ok/degraded/unready per consumer against the given thresholds", async () => {
    const port: BacklogCheckPort = {
      countBacklog: async (consumer) =>
        ({ audit: 5, billing: 150, reporting: 2000 })[consumer] ?? 0,
    };
    const deps = baseDeps({
      backlog: {
        port,
        consumers: ["audit", "billing", "reporting"],
        thresholds: { degraded: 100, unready: 1000 },
      },
    });
    const result = await checkReadiness(deps);
    expect(result.checks.backlog?.consumers.audit).toEqual({ count: 5, status: "ok" });
    expect(result.checks.backlog?.consumers.billing).toEqual({ count: 150, status: "degraded" });
    expect(result.checks.backlog?.consumers.reporting).toEqual({ count: 2000, status: "failing" });
    expect(result.status).toBe("unready");
  });
});

describe("checkReadiness — module health folding", () => {
  it("is omitted from the response when no CoreStack is given", async () => {
    const result = await checkReadiness(baseDeps());
    expect(result.modules).toBeUndefined();
  });

  it("folds CoreStack.health() verbatim and includes it in the worst-of calculation", async () => {
    const health: CoreStackHealth = {
      status: "unhealthy",
      modules: { tenancy: { status: "unhealthy" } },
    };
    const coreStack: CoreStack = {
      modules: {},
      health: async () => health,
    };
    const result = await checkReadiness(baseDeps({ coreStack }));
    expect(result.modules).toEqual(health);
    expect(result.status).toBe("unready");
  });

  it("a degraded module degrades overall readiness without a database/migrations problem", async () => {
    const coreStack: CoreStack = {
      modules: {},
      health: async () => ({ status: "degraded", modules: { billing: { status: "degraded" } } }),
    };
    const result = await checkReadiness(baseDeps({ coreStack }));
    expect(result.status).toBe("degraded");
  });
});

describe("RelayLagRecorder", () => {
  it("records the latest reading per consumer and exposes it via snapshot", () => {
    const clock = new FixedClock(NOW);
    const recorder = new RelayLagRecorder(clock);
    recorder.record("audit", 10);
    recorder.record("audit", 20);
    const snapshot = recorder.snapshot();
    expect(snapshot.get("audit")).toEqual({ lagMs: 20, recordedAt: NOW });
    expect(snapshot.size).toBe(1);
  });

  it("can be bound directly as an OutboxRelayOptions.onLag callback", () => {
    const recorder = new RelayLagRecorder(new FixedClock(NOW));
    const onLag: (consumer: string, lagMs: number) => void = recorder.record;
    onLag("billing", 42);
    expect(recorder.snapshot().get("billing")?.lagMs).toBe(42);
  });
});

/**
 * `checkLiveness`/`checkReadiness` are plain functions taking dependencies
 * as parameters, not a port with swappable implementations — there is
 * nothing for a contract-suite factory to construct (see
 * docs/testing/adapter-certification-matrix.md, "Health-check: not
 * applicable"). Per the founder directive's own request to
 * "snapshot-test the public payloads" instead, these two tests pin the
 * exact JSON shape once each for the minimal and fully-configured cases —
 * every existing test above already asserts individual field values in
 * depth; this pair exists purely to catch an accidental shape change
 * (an added/removed/renamed field) that per-field assertions could miss
 * if a new field were added without updating any of them.
 */
describe("health payload shape (snapshot)", () => {
  it("checkLiveness's payload shape", () => {
    expect(checkLiveness(new FixedClock(NOW))).toMatchSnapshot();
  });

  it("checkReadiness's payload shape — minimal (nothing optional configured)", async () => {
    const result = await checkReadiness(baseDeps());
    expect(result).toMatchSnapshot();
  });

  it("checkReadiness's payload shape — every optional check configured", async () => {
    const recorder = new RelayLagRecorder(new FixedClock(NOW));
    recorder.record("audit", 100);
    const backlogPort: BacklogCheckPort = { countBacklog: async () => 5 };
    const coreStack: CoreStack = {
      modules: {},
      health: async () => ({ status: "healthy", modules: { tenancy: { status: "healthy" } } }),
    };

    const result = await checkReadiness(
      baseDeps({
        relayLag: {
          recorder,
          thresholds: { degradedMs: 30_000, unreadyMs: 300_000, staleAfterMs: 600_000 },
        },
        backlog: { port: backlogPort, consumers: ["audit"], thresholds: { degraded: 100, unready: 1000 } },
        coreStack,
      }),
    );
    expect(result).toMatchSnapshot();
  });
});
