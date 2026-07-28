import { describe, expect, it } from "vitest";

import {
  planPartitionDrops,
  type ExistingPartition,
} from "../../src/domain/outbox-partition-retention.js";

const cutoff = new Date("2026-06-01T00:00:00Z");

function partition(name: string, to: string): ExistingPartition {
  return { name, to: new Date(to) };
}

describe("planPartitionDrops", () => {
  it("does not touch a partition whose upper bound is after the cutoff (too recent)", () => {
    const partitions = [partition("outbox_2026_06", "2026-07-01T00:00:00Z")];
    const plan = planPartitionDrops(partitions, cutoff, [], new Map());
    expect(plan.droppable).toEqual([]);
    expect(plan.blocked).toEqual([]);
  });

  it("drops a retention-eligible partition when there are no expected consumers at all", () => {
    const partitions = [partition("outbox_2026_01", "2026-02-01T00:00:00Z")];
    const plan = planPartitionDrops(partitions, cutoff, [], new Map());
    expect(plan.droppable).toEqual(["outbox_2026_01"]);
    expect(plan.blocked).toEqual([]);
  });

  it("blocks a drop when an expected consumer has NO checkpoint row at all — the dangerous case", () => {
    const partitions = [partition("outbox_2026_01", "2026-02-01T00:00:00Z")];
    const checkpoints = new Map<string, Date | null>([["audit", null]]);
    const plan = planPartitionDrops(partitions, cutoff, ["audit"], checkpoints);

    expect(plan.droppable).toEqual([]);
    expect(plan.blocked).toEqual([
      { name: "outbox_2026_01", reason: 'consumer "audit" has not processed past this partition' },
    ]);
  });

  it("blocks a drop when a consumer's checkpoint hasn't reached the partition's upper bound yet", () => {
    const partitions = [partition("outbox_2026_01", "2026-02-01T00:00:00Z")];
    const checkpoints = new Map<string, Date | null>([["audit", new Date("2026-01-15T00:00:00Z")]]);
    const plan = planPartitionDrops(partitions, cutoff, ["audit"], checkpoints);

    expect(plan.droppable).toEqual([]);
    expect(plan.blocked[0]?.name).toBe("outbox_2026_01");
  });

  it("drops a partition once every expected consumer's checkpoint is at or past its upper bound", () => {
    const partitions = [partition("outbox_2026_01", "2026-02-01T00:00:00Z")];
    const checkpoints = new Map<string, Date | null>([
      ["audit", new Date("2026-03-01T00:00:00Z")],
      ["billing", new Date("2026-02-01T00:00:00Z")], // exactly at the upper bound — sufficient
    ]);
    const plan = planPartitionDrops(partitions, cutoff, ["audit", "billing"], checkpoints);

    expect(plan.droppable).toEqual(["outbox_2026_01"]);
  });

  it("one lagging consumer among several blocks the drop even if all others are caught up", () => {
    const partitions = [partition("outbox_2026_01", "2026-02-01T00:00:00Z")];
    const checkpoints = new Map<string, Date | null>([
      ["audit", new Date("2026-03-01T00:00:00Z")],
      ["billing", null], // registered but never processed anything
    ]);
    const plan = planPartitionDrops(partitions, cutoff, ["audit", "billing"], checkpoints);

    expect(plan.droppable).toEqual([]);
    expect(plan.blocked[0]?.reason).toContain("billing");
  });

  it("evaluates multiple partitions independently — some droppable, some blocked, some too recent", () => {
    const partitions = [
      partition("outbox_2025_11", "2025-12-01T00:00:00Z"), // droppable
      partition("outbox_2025_12", "2026-01-01T00:00:00Z"), // blocked
      partition("outbox_2026_06", "2026-07-01T00:00:00Z"), // too recent
    ];
    const checkpoints = new Map<string, Date | null>([["audit", new Date("2025-12-15T00:00:00Z")]]);
    const plan = planPartitionDrops(partitions, cutoff, ["audit"], checkpoints);

    expect(plan.droppable).toEqual(["outbox_2025_11"]);
    expect(plan.blocked.map((b) => b.name)).toEqual(["outbox_2025_12"]);
  });
});
