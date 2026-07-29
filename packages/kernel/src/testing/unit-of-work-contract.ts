/**
 * The `UnitOfWork` port's contract suite (E04, following E04-T01's
 * framework). Scoped to exactly what `unit-of-work.ts`'s doc comment makes
 * normative across every adapter: `run` returns the work callback's
 * result, staged events are dispatched only after commit and in stage
 * order, and staged events (along with any other writes) are discarded
 * entirely when `work` throws.
 *
 * **Deliberately excluded, adapter-specific:**
 * - `InMemoryUnitOfWork`'s `onDispatchError` observer option.
 * - `PostgresUnitOfWork` setting `app.current_org` for its transaction's
 *   duration.
 * - Nested-`UnitOfWork` rejection. The port doc states nesting isn't
 *   supported, but only a connection-backed adapter (`PostgresUnitOfWork`,
 *   via `TransactionSql` having no `.begin()`) can mechanically enforce
 *   this — a real resource is shared and would conflict. The in-memory
 *   reference adapter has no such shared resource: two independent
 *   `InMemoryUnitOfWork` instances (even sharing one `EventBus`) nested
 *   inside each other cause no corruption, since JS's single-threaded
 *   execution just pauses the outer callback while the inner completes.
 *   Manufacturing an artificial reentrancy guard on the in-memory adapter
 *   would catch only same-instance nesting (not the general pattern the
 *   doc warns about) for no real safety payoff — so this stays a
 *   Postgres-specific integration test
 *   (`unit-of-work.postgres.test.ts`'s "SECURITY MATRIX §4.5"), not a
 *   portable assertion.
 * - Relay retry/checkpoint semantics (`OutboxRelay`'s own contract, not
 *   `UnitOfWork`'s).
 *
 * `drainDispatched()` is how the factory reports "every currently-
 * committed staged event, delivered." The mechanism differs completely
 * per adapter — the in-memory adapter dispatches synchronously inside
 * `run()`; a connection-backed adapter stages into durable storage and
 * relies on a separate relay process to dispatch later — which is exactly
 * why this abstraction exists rather than asserting on a bus directly.
 */
import type { DomainEvent } from "../event.js";
import type { UnitOfWork } from "../unit-of-work.js";
import type { SuiteHarness } from "./harness.js";

export interface UnitOfWorkContractAdapter {
  readonly uow: UnitOfWork;
  /** Every staged event actually delivered so far, in delivery order. */
  drainDispatched(): Promise<readonly DomainEvent[]>;
}

export interface UnitOfWorkContractFactory {
  (): UnitOfWorkContractAdapter | Promise<UnitOfWorkContractAdapter>;
}

export function defineUnitOfWorkContractSuite(
  harness: SuiteHarness,
  factory: UnitOfWorkContractFactory,
  makeEvent: (idSuffix: string) => DomainEvent,
): void {
  const { describe, it, expect } = harness;

  describe("UnitOfWork contract", () => {
    it("run() returns the work callback's result", async () => {
      const { uow } = await factory();
      const result = await uow.run(async () => "done");
      expect(result).toBe("done");
    });

    it("staged events are dispatched only after commit, in stage order", async () => {
      const { uow, drainDispatched } = await factory();
      expect(await drainDispatched()).toEqual([]);

      const first = makeEvent("a");
      const second = makeEvent("b");
      await uow.run(async (tx) => {
        tx.publish(first);
        tx.publish(second);
        return "committed";
      });

      const dispatched = await drainDispatched();
      expect(dispatched.map((e) => e.id)).toEqual([first.id, second.id]);
    });

    it("staged events (and the work's own effect) are discarded entirely when work throws", async () => {
      const { uow, drainDispatched } = await factory();

      await expect(
        uow.run(async (tx) => {
          tx.publish(makeEvent("discarded"));
          throw new Error("simulated use-case failure");
        }),
      ).rejects.toThrow("simulated use-case failure");

      expect(await drainDispatched()).toEqual([]);
    });
  });
}
