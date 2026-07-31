import { FixedClock, InMemoryEventBus, InMemoryUnitOfWork, type IdGenerator } from "@corestack/kernel";

import { InMemoryOrganizationRepository } from "../../../test-support/in-memory-organization-repository.js";
import { InMemoryMembershipRepository } from "../../../test-support/in-memory-membership-repository.js";
import { InMemoryInvitationRepository } from "../../../test-support/in-memory-invitation-repository.js";
import type { TenancyHttpDeps } from "../../../src/interface/http/types.js";

/** Same deterministic, valid-UUID-shaped id generator every `test/application/*.test.ts`/`test-support/workflow-harness.ts` file already uses. */
export class SequentialUuidGenerator implements IdGenerator {
  #next = 0;

  generate(): string {
    this.#next += 1;
    return `00000000-0000-7000-8000-${this.#next.toString().padStart(12, "0")}`;
  }
}

export const REFERENCE_DATE = new Date("2026-07-30T00:00:00.000Z");

/**
 * Wires `TenancyHttpDeps` against the in-memory reference repositories —
 * the same "real, reusable in-memory implementation" `TenancyWorkflowHarness`
 * uses (E05-T08), not per-test throwaway fakes. `uowFactory` always
 * returns the same shared `InMemoryUnitOfWork` instance regardless of
 * `organizationId`, matching every in-memory-backed test elsewhere in
 * this package.
 */
export function buildHttpDeps(): TenancyHttpDeps {
  const ids = new SequentialUuidGenerator();
  const clock = new FixedClock(REFERENCE_DATE);
  const uow = new InMemoryUnitOfWork(new InMemoryEventBus());
  return {
    uowFactory: () => uow,
    organizationRepository: new InMemoryOrganizationRepository(),
    membershipRepository: new InMemoryMembershipRepository(),
    invitationRepository: new InMemoryInvitationRepository(),
    ids,
    clock,
    invitationExpiryDays: 7,
  };
}
