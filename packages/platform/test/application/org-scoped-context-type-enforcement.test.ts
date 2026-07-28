/**
 * Type-level proof for E03-T31's acceptance criterion: "Type error (not
 * runtime) when org-scoped helper called without org." The function below
 * is never invoked — it exists solely so `tsc --noEmit` (the `typecheck`
 * script, which includes `test/`) checks the `@ts-expect-error` line. If
 * `OrgScopedContext` ever regressed to accepting `Context` directly (e.g.
 * `organizationId` widened back to `string | null`), the `@ts-expect-error`
 * would itself become a compile error ("Unused '@ts-expect-error'
 * directive") — so this test fails loudly on that regression too, not
 * just silently stop proving anything.
 */
import { describe, expect, it } from "vitest";
import type { Context } from "@corestack/kernel";
import type { Sql } from "postgres";

import { runOrgScopedQuery } from "../../src/infrastructure/postgres-org-scoped-repository.js";
import type { OrgScopedContext } from "../../src/application/org-scoped-context.js";

function typeOnlyCheck(sql: Sql, plainContext: Context): void {
  // @ts-expect-error — Context.organizationId is `string | null`; runOrgScopedQuery
  // requires OrgScopedContext (organizationId: string). Passing a plain,
  // unnarrowed Context must fail at compile time, not at runtime.
  void runOrgScopedQuery(sql, plainContext, async () => undefined);
}

function typeOnlyCheckAcceptsNarrowed(sql: Sql, scoped: OrgScopedContext): void {
  // No error: a narrowed OrgScopedContext is exactly what's required.
  void runOrgScopedQuery(sql, scoped, async () => undefined);
}

describe("OrgScopedContext type enforcement (E03-T31)", () => {
  it("exists only to be checked by tsc --noEmit, not executed", () => {
    expect(typeof typeOnlyCheck).toBe("function");
    expect(typeof typeOnlyCheckAcceptsNarrowed).toBe("function");
  });
});
