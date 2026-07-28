import { describe, expect, it } from "vitest";

import { computeMonthlyPartitionBounds } from "../../src/domain/outbox-partition.js";

describe("computeMonthlyPartitionBounds", () => {
  it("returns the current month only when monthsAhead is 0", () => {
    const bounds = computeMonthlyPartitionBounds(new Date("2026-07-15T12:00:00Z"), 0);
    expect(bounds).toEqual([{ name: "outbox_2026_07", from: "2026-07-01", to: "2026-08-01" }]);
  });

  it("returns the current month plus N months ahead, in order", () => {
    const bounds = computeMonthlyPartitionBounds(new Date("2026-07-15T12:00:00Z"), 2);
    expect(bounds).toEqual([
      { name: "outbox_2026_07", from: "2026-07-01", to: "2026-08-01" },
      { name: "outbox_2026_08", from: "2026-08-01", to: "2026-09-01" },
      { name: "outbox_2026_09", from: "2026-09-01", to: "2026-10-01" },
    ]);
  });

  it("rolls over the year boundary correctly", () => {
    const bounds = computeMonthlyPartitionBounds(new Date("2026-12-10T00:00:00Z"), 1);
    expect(bounds).toEqual([
      { name: "outbox_2026_12", from: "2026-12-01", to: "2027-01-01" },
      { name: "outbox_2027_01", from: "2027-01-01", to: "2027-02-01" },
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
