import { describe, expect, it } from "vitest";
import { createContext, FixedClock, SequentialIdGenerator } from "@corestack/kernel";

import { requireOrgScoped } from "@corestack/platform";
import { createContact } from "../../src/application/create-contact.js";
import type { ContactRepository } from "../../src/application/contact-repository.js";
import type { PostgresUnitOfWork } from "@corestack/platform/postgres";

const ids = new SequentialIdGenerator("corr-");
const clock = new FixedClock(new Date("2026-07-29T00:00:00Z"));

function scopedContext() {
  return requireOrgScoped(
    createContext(
      { actor: { type: "user", id: "u1" }, organizationId: "11111111-1111-1111-1111-111111111111" },
      ids,
    ),
  );
}

describe("createContact", () => {
  it("rejects invalid input before ever touching the UnitOfWork or repository", async () => {
    let uowCalled = false;
    let repoCalled = false;

    const fakeUow = {
      run: async () => {
        uowCalled = true;
        throw new Error("should never run");
      },
    } as unknown as PostgresUnitOfWork;

    const fakeRepository: ContactRepository = {
      create: async () => {
        repoCalled = true;
        throw new Error("should never run");
      },
      list: async () => [],
    };

    const result = await createContact(
      scopedContext(),
      { name: "  ", email: "not-an-email" },
      { uow: fakeUow, repository: fakeRepository, ids, clock },
    );

    expect(result.ok).toBe(false);
    expect(uowCalled).toBe(false);
    expect(repoCalled).toBe(false);
  });
});
