/**
 * `@corestack/kernel/testing` — the contract-suite framework (E04-T01,
 * Architecture §44).
 *
 * A contract suite is a plain function that declares a port's normative
 * behavior once (`describe`/`it`/`expect`), then runs against whatever
 * implementation a `factory` produces — the kernel's own in-memory adapter,
 * or a real Postgres/Redis adapter in another package. The suite itself
 * never imports a test runner: `SuiteHarness` types its `describe`/`it`/
 * `expect`/`beforeEach`/`afterEach` parameters via `import type` only, which
 * TypeScript erases at compile time. That keeps this subpath — like the rest
 * of the kernel — at zero runtime dependencies (fitness-test-enforced); a
 * caller just passes in the same `describe`/`it`/`expect` it already
 * imported from its own test runner.
 */
import type {
  afterEach as AfterEach,
  beforeEach as BeforeEach,
  describe as Describe,
  expect as Expect,
  it as It,
} from "vitest";

export interface SuiteHarness {
  readonly describe: typeof Describe;
  readonly it: typeof It;
  readonly expect: typeof Expect;
  readonly beforeEach: typeof BeforeEach;
  readonly afterEach: typeof AfterEach;
}
