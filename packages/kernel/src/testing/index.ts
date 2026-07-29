/**
 * `@corestack/kernel/testing` — the contract-suite framework (E04-T01).
 * Fakes and utilities for testing code that depends on kernel ports, kept
 * out of the production bundle (Architecture §45/§7 subpath convention),
 * mirroring `@corestack/platform/testing`'s existing pattern.
 */
export type { SuiteHarness } from "./harness.js";
export { defineCacheContractSuite, type CacheContractFactory } from "./cache-contract.js";
export {
  defineRateLimiterContractSuite,
  type RateLimiterContractFactory,
} from "./rate-limiter-contract.js";
export {
  defineLoggerContractSuite,
  type LoggerContractAdapter,
  type LoggerContractFactory,
} from "./logger-contract.js";
export {
  defineEventBusContractSuite,
  type EventBusContractFactory,
} from "./event-bus-contract.js";
