import { describe, expect, it } from "vitest";
import { ForbiddenError, createContext, SequentialIdGenerator } from "@corestack/kernel";

import { requireOrgScoped } from "../../src/application/org-scoped-context.js";

const ids = () => new SequentialIdGenerator("corr-");

describe("requireOrgScoped (E03-T31)", () => {
  it("narrows a Context with a non-null organizationId", () => {
    const context = createContext(
      { actor: { type: "user", id: "u1" }, organizationId: "org-1" },
      ids(),
    );
    const scoped = requireOrgScoped(context);
    expect(scoped.organizationId).toBe("org-1");
  });

  it("throws ForbiddenError for a platform-scoped (null-org) Context", () => {
    const context = createContext({ actor: { type: "system", id: null } }, ids());
    expect(() => requireOrgScoped(context)).toThrow(ForbiddenError);
  });

  it("preserves the rest of the context's fields unchanged", () => {
    const context = createContext(
      {
        actor: { type: "user", id: "u1" },
        organizationId: "org-1",
        correlationId: "corr-fixed",
        causationId: "event-1",
        locale: "en-US",
      },
      ids(),
    );
    const scoped = requireOrgScoped(context);
    expect(scoped.actor).toEqual({ type: "user", id: "u1" });
    expect(scoped.correlationId).toBe("corr-fixed");
    expect(scoped.causationId).toBe("event-1");
    expect(scoped.locale).toBe("en-US");
  });

  it("includes the correlationId in the thrown error's metadata for traceability", () => {
    const context = createContext(
      { actor: { type: "system", id: null }, correlationId: "corr-trace" },
      ids(),
    );
    try {
      requireOrgScoped(context);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).metadata.correlationId).toBe("corr-trace");
    }
  });
});
