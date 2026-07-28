/**
 * Health/readiness computation (E03-T23; docs/platform/health-contract.md).
 *
 * Ships as plain functions returning exactly the contract's JSON shapes —
 * `packages/platform` has no `interface/` layer or HTTP framework yet
 * (ADR-0012's REST API is a later epic), so this is health *computation*,
 * not routes. A future transport wires `checkLiveness`/`checkReadiness`
 * into `GET /health/live` / `GET /health/ready`.
 *
 * `versionMismatch` from the original contract draft is intentionally not
 * implemented: `platform.module_migrations.version` is a per-module
 * migration version, not an application/binary release version, and no
 * field exists anywhere in the shipped schema for the latter (see the
 * contract's "Known gap: version mismatch" section).
 */
import type { Clock } from "@corestack/kernel";

import {
  checkStatusToReadinessLevel,
  moduleHealthStatusToReadinessLevel,
  worstCheckStatus,
  worstReadinessLevel,
  type CheckStatus,
  type ReadinessLevel,
} from "../domain/health.js";
import type { CoreStack, CoreStackHealth } from "./create-core-stack.js";

export interface LivenessResult {
  readonly status: "live";
  readonly timestamp: string;
}

/** Zero dependency checks, by design — a slow dependency must never cause a false liveness failure and a restart loop. */
export function checkLiveness(clock: Clock): LivenessResult {
  return { status: "live", timestamp: clock.now().toISOString() };
}

export interface DatabasePingPort {
  /** Resolves with round-trip latency in ms; rejects on failure or timeout. */
  ping(): Promise<{ readonly latencyMs: number }>;
  /** The database server's own clock, for skew detection against it. */
  now(): Promise<Date>;
}

export interface MigrationsStatusPort {
  /** Applied version per module, from `platform.module_migrations`. A module absent from the map has never been migrated (version 0). */
  appliedVersions(): Promise<ReadonlyMap<string, number>>;
}

export interface RelayLagReading {
  readonly lagMs: number;
  readonly recordedAt: Date;
}

export interface RelayLagThresholds {
  readonly degradedMs: number;
  readonly unreadyMs: number;
  /** A reading older than this is treated as failing regardless of its own lagMs — a relay that stopped polling must not read as still-healthy at its last reported value. */
  readonly staleAfterMs: number;
}

/**
 * Records `OutboxRelay`'s `onLag(consumer, lagMs)` callback output in
 * memory, per consumer, together with when each reading arrived. Bind
 * `record` directly as `OutboxRelayOptions.onLag`.
 */
export class RelayLagRecorder {
  readonly #readings = new Map<string, RelayLagReading>();
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  readonly record = (consumer: string, lagMs: number): void => {
    this.#readings.set(consumer, { lagMs, recordedAt: this.#clock.now() });
  };

  snapshot(): ReadonlyMap<string, RelayLagReading> {
    return new Map(this.#readings);
  }
}

export interface RelayLagConsumerResult {
  readonly lagMs: number;
  readonly staleMs: number;
  readonly status: CheckStatus;
}

export interface RelayLagCheckResult {
  readonly status: CheckStatus;
  readonly consumers: Readonly<Record<string, RelayLagConsumerResult>>;
}

export interface BacklogCheckPort {
  countBacklog(consumer: string): Promise<number>;
}

export interface BacklogThresholds {
  readonly degraded: number;
  readonly unready: number;
}

export interface BacklogConsumerResult {
  readonly count: number;
  readonly status: CheckStatus;
}

export interface BacklogCheckResult {
  readonly status: CheckStatus;
  readonly consumers: Readonly<Record<string, BacklogConsumerResult>>;
}

export interface DatabaseCheckResult {
  readonly status: CheckStatus;
  readonly latencyMs?: number;
}

export interface ClockSkewCheckResult {
  readonly status: CheckStatus;
  readonly skewMs?: number;
}

export interface MigrationsCheckResult {
  readonly status: CheckStatus;
  readonly pendingCount: number;
  readonly pendingModules?: readonly string[] | undefined;
}

export interface ReadinessThresholds {
  readonly databaseLatencyDegradedMs: number;
  readonly clockSkewDegradedMs: number;
  readonly clockSkewUnreadyMs: number;
}

export interface ReadinessDeps {
  readonly clock: Clock;
  readonly database: DatabasePingPort;
  readonly migrations: MigrationsStatusPort;
  /** Expected (latest) migration version per module — derived by the caller from each installed `ModuleInstance.migrations`, since only the composition root knows what modules are installed. */
  readonly expectedVersions: ReadonlyMap<string, number>;
  readonly thresholds: ReadinessThresholds;
  readonly relayLag?: {
    readonly recorder: RelayLagRecorder;
    readonly thresholds: RelayLagThresholds;
  };
  readonly backlog?: {
    readonly port: BacklogCheckPort;
    readonly consumers: readonly string[];
    readonly thresholds: BacklogThresholds;
  };
  /** Folds `CoreStack.health()` (E03-T21) into readiness verbatim, per the contract — not a second module-health mechanism. */
  readonly coreStack?: CoreStack;
}

export interface ReadinessResult {
  readonly status: ReadinessLevel;
  readonly timestamp: string;
  readonly checks: {
    readonly database: DatabaseCheckResult;
    readonly migrations: MigrationsCheckResult;
    readonly clockSkew: ClockSkewCheckResult;
    readonly relayLag?: RelayLagCheckResult | undefined;
    readonly backlog?: BacklogCheckResult | undefined;
  };
  readonly modules?: CoreStackHealth | undefined;
}

function checkRelayLag(
  snapshot: ReadonlyMap<string, RelayLagReading>,
  thresholds: RelayLagThresholds,
  clock: Clock,
): RelayLagCheckResult {
  const consumers: Record<string, RelayLagConsumerResult> = {};
  for (const [consumer, reading] of snapshot) {
    const staleMs = clock.now().getTime() - reading.recordedAt.getTime();
    let status: CheckStatus = "ok";
    if (staleMs > thresholds.staleAfterMs || reading.lagMs > thresholds.unreadyMs) {
      status = "failing";
    } else if (reading.lagMs > thresholds.degradedMs) {
      status = "degraded";
    }
    consumers[consumer] = { lagMs: reading.lagMs, staleMs, status };
  }
  return {
    status: worstCheckStatus(Object.values(consumers).map((c) => c.status)),
    consumers,
  };
}

async function checkBacklog(
  port: BacklogCheckPort,
  consumers: readonly string[],
  thresholds: BacklogThresholds,
): Promise<BacklogCheckResult> {
  const entries = await Promise.all(
    consumers.map(async (consumer) => {
      const count = await port.countBacklog(consumer);
      const status: CheckStatus =
        count > thresholds.unready ? "failing" : count > thresholds.degraded ? "degraded" : "ok";
      return [consumer, { count, status }] as const;
    }),
  );
  const result: Record<string, BacklogConsumerResult> = Object.fromEntries(entries);
  return { status: worstCheckStatus(entries.map(([, r]) => r.status)), consumers: result };
}

export async function checkReadiness(deps: ReadinessDeps): Promise<ReadinessResult> {
  let database: DatabaseCheckResult;
  let databaseNow: Date | null = null;
  try {
    const [ping, now] = await Promise.all([deps.database.ping(), deps.database.now()]);
    databaseNow = now;
    database = {
      status: ping.latencyMs > deps.thresholds.databaseLatencyDegradedMs ? "degraded" : "ok",
      latencyMs: ping.latencyMs,
    };
  } catch {
    database = { status: "failing" };
  }

  const clockSkew: ClockSkewCheckResult =
    databaseNow === null
      ? { status: "failing" }
      : (() => {
          const skewMs = Math.abs(deps.clock.now().getTime() - databaseNow.getTime());
          const status: CheckStatus =
            skewMs > deps.thresholds.clockSkewUnreadyMs
              ? "failing"
              : skewMs > deps.thresholds.clockSkewDegradedMs
                ? "degraded"
                : "ok";
          return { status, skewMs };
        })();

  let migrations: MigrationsCheckResult;
  try {
    const applied = await deps.migrations.appliedVersions();
    const pendingModules: string[] = [];
    for (const [module, expected] of deps.expectedVersions) {
      if ((applied.get(module) ?? 0) < expected) pendingModules.push(module);
    }
    migrations = {
      status: pendingModules.length > 0 ? "failing" : "ok",
      pendingCount: pendingModules.length,
      pendingModules: pendingModules.length > 0 ? pendingModules : undefined,
    };
  } catch {
    migrations = { status: "failing", pendingCount: 0 };
  }

  const relayLag = deps.relayLag
    ? checkRelayLag(deps.relayLag.recorder.snapshot(), deps.relayLag.thresholds, deps.clock)
    : undefined;
  const backlog = deps.backlog
    ? await checkBacklog(deps.backlog.port, deps.backlog.consumers, deps.backlog.thresholds)
    : undefined;
  const modules = deps.coreStack ? await deps.coreStack.health() : undefined;

  const levels: ReadinessLevel[] = [
    checkStatusToReadinessLevel(database.status),
    checkStatusToReadinessLevel(migrations.status),
    checkStatusToReadinessLevel(clockSkew.status),
  ];
  if (relayLag !== undefined) levels.push(checkStatusToReadinessLevel(relayLag.status));
  if (backlog !== undefined) levels.push(checkStatusToReadinessLevel(backlog.status));
  if (modules !== undefined) levels.push(moduleHealthStatusToReadinessLevel(modules.status));

  return {
    status: worstReadinessLevel(levels),
    timestamp: deps.clock.now().toISOString(),
    checks: { database, migrations, clockSkew, relayLag, backlog },
    modules,
  };
}
