import { describe, expect, it } from "vitest";

import {
  checkStatusToReadinessLevel,
  moduleHealthStatusToReadinessLevel,
  worstCheckStatus,
  worstReadinessLevel,
} from "../../src/domain/health.js";

describe("worstCheckStatus", () => {
  it("returns ok for an empty list", () => {
    expect(worstCheckStatus([])).toBe("ok");
  });

  it("returns ok when everything is ok", () => {
    expect(worstCheckStatus(["ok", "ok"])).toBe("ok");
  });

  it("returns degraded when the worst present is degraded", () => {
    expect(worstCheckStatus(["ok", "degraded", "ok"])).toBe("degraded");
  });

  it("returns failing when any is failing, regardless of order", () => {
    expect(worstCheckStatus(["degraded", "failing", "ok"])).toBe("failing");
    expect(worstCheckStatus(["failing", "ok"])).toBe("failing");
  });
});

describe("worstReadinessLevel", () => {
  it("returns ready for an empty list", () => {
    expect(worstReadinessLevel([])).toBe("ready");
  });

  it("escalates ready -> degraded -> unready correctly", () => {
    expect(worstReadinessLevel(["ready", "ready"])).toBe("ready");
    expect(worstReadinessLevel(["ready", "degraded"])).toBe("degraded");
    expect(worstReadinessLevel(["degraded", "unready", "ready"])).toBe("unready");
  });
});

describe("checkStatusToReadinessLevel", () => {
  it("maps each status to its corresponding readiness level", () => {
    expect(checkStatusToReadinessLevel("ok")).toBe("ready");
    expect(checkStatusToReadinessLevel("degraded")).toBe("degraded");
    expect(checkStatusToReadinessLevel("failing")).toBe("unready");
  });
});

describe("moduleHealthStatusToReadinessLevel", () => {
  it("maps each module health status to its corresponding readiness level", () => {
    expect(moduleHealthStatusToReadinessLevel("healthy")).toBe("ready");
    expect(moduleHealthStatusToReadinessLevel("degraded")).toBe("degraded");
    expect(moduleHealthStatusToReadinessLevel("unhealthy")).toBe("unready");
  });
});
