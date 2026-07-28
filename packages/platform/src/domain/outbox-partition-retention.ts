/**
 * Retention-drop planning for `platform.outbox` partitions (E03-T03; DB
 * design §3: "old partitions dropped per retention policy after all
 * checkpoints pass them"). Pure — no I/O — so the safety logic is
 * testable without Postgres, separately from the DDL that acts on it.
 */

export interface ExistingPartition {
  readonly name: string;
  /** Exclusive upper bound — a row in this partition has `occurred_at < to`. */
  readonly to: Date;
}

export interface PartitionDropPlan {
  readonly droppable: readonly string[];
  readonly blocked: readonly { readonly name: string; readonly reason: string }[];
}

/**
 * A partition may only be dropped once **every** expected consumer's
 * checkpoint has advanced past it. Absence of a checkpoint row means that
 * consumer has never processed anything (E03-T12's own convention) — the
 * dangerous direction to get wrong is treating "no rows yet" as "everyone
 * caught up," which would authorize dropping a fresh deploy's entire
 * outbox before the relay has run once. An empty `expectedConsumers` list
 * is the caller's explicit declaration that no consumer depends on this
 * outbox yet; drops then depend on retention age alone.
 */
export function planPartitionDrops(
  partitions: readonly ExistingPartition[],
  cutoff: Date,
  expectedConsumers: readonly string[],
  checkpoints: ReadonlyMap<string, Date | null>,
): PartitionDropPlan {
  const droppable: string[] = [];
  const blocked: { name: string; reason: string }[] = [];

  for (const partition of partitions) {
    if (partition.to.getTime() > cutoff.getTime()) {
      continue; // not yet retention-eligible — neither droppable nor blocked, just too recent
    }

    const laggingConsumer = expectedConsumers.find((consumer) => {
      const lastOccurredAt = checkpoints.get(consumer) ?? null;
      return lastOccurredAt === null || lastOccurredAt.getTime() < partition.to.getTime();
    });

    if (laggingConsumer !== undefined) {
      blocked.push({
        name: partition.name,
        reason: `consumer "${laggingConsumer}" has not processed past this partition`,
      });
    } else {
      droppable.push(partition.name);
    }
  }

  return { droppable, blocked };
}
