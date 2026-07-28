import { describe, expect, it } from "vitest";

import {
  computeMonthlyPartitionBounds,
  partitionUpperBound,
} from "../../src/domain/outbox-partition.js";

describe("computeMonthlyPartitionBounds", () => {
  it("returns the current month only when monthsAhead is 0", () => {
    const bounds = computeMonthlyPartitionBounds(new Date("2026-07-15T12:00:00Z"), 0);
    expect(bounds).toEqual([
      {
        name: "outbox_2026_07",
        from: "2026-07-01T00:00:00+00:00",
        to: "2026-08-01T00:00:00+00:00",
      },
    ]);
  });

  it("returns the current month plus N months ahead, in order", () => {
    const bounds = computeMonthlyPartitionBounds(new Date("2026-07-15T12:00:00Z"), 2);
    expect(bounds).toEqual([
      {
        name: "outbox_2026_07",
        from: "2026-07-01T00:00:00+00:00",
        to: "2026-08-01T00:00:00+00:00",
      },
      {
        name: "outbox_2026_08",
        from: "2026-08-01T00:00:00+00:00",
        to: "2026-09-01T00:00:00+00:00",
      },
      {
        name: "outbox_2026_09",
        from: "2026-09-01T00:00:00+00:00",
        to: "2026-10-01T00:00:00+00:00",
      },
    ]);
  });

  it("rolls over the year boundary correctly", () => {
    const bounds = computeMonthlyPartitionBounds(new Date("2026-12-10T00:00:00Z"), 1);
    expect(bounds).toEqual([
      {
        name: "outbox_2026_12",
        from: "2026-12-01T00:00:00+00:00",
        to: "2027-01-01T00:00:00+00:00",
      },
      {
        name: "outbox_2027_01",
        from: "2027-01-01T00:00:00+00:00",
        to: "2027-02-01T00:00:00+00:00",
      },
    ]);
  });

  it("is anchored to UTC regardless of the reference Date's local representation", () => {
    // A reference right at a UTC month boundary must not shift due to
    // local-timezone interpretation.
    const bounds = computeMonthlyPartitionBounds(new Date("2026-03-01T00:00:00.000Z"), 0);
    expect(bounds[0]?.name).toBe("outbox_2026_03");
  });

  it("partition names sort lexicographically in chronological order", () => {
    const bounds = computeMonthlyPartitionBounds(new Date("2026-09-15T00:00:00Z"), 4);
    const names = bounds.map((b) => b.name);
    expect([...names].sort()).toEqual(names);
  });
});

describe("partitionUpperBound", () => {
  it("is the exact inverse of the name computeMonthlyPartitionBounds generates", () => {
    const bounds = computeMonthlyPartitionBounds(new Date("2026-07-15T00:00:00Z"), 0);
    const bound = bounds[0];
    expect(bound).toBeDefined();
    expect(partitionUpperBound(bound!.name)?.toISOString()).toBe(new Date(bound!.to).toISOString());
  });

  it("rolls over the year correctly (outbox_2026_12 -> 2027-01-01)", () => {
    expect(partitionUpperBound("outbox_2026_12")?.toISOString()).toBe(
      new Date("2027-01-01T00:00:00Z").toISOString(),
    );
  });

  it("returns null for a name that doesn't match the pattern", () => {
    expect(partitionUpperBound("outbox_2026")).toBeNull();
    expect(partitionUpperBound("outbox_2026_13")).not.toBeNull(); // month range isn't validated, just shape
    expect(partitionUpperBound("something_else")).toBeNull();
    expect(partitionUpperBound("module_migrations")).toBeNull();
  });
});
