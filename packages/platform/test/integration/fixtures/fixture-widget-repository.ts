/**
 * A minimal but *real* org-scoped repository, used to prove E03-T31's
 * `OrgScopedContext`/`runOrgScopedQuery` are actually usable to build a
 * repository — not just type-check in isolation. Test-only: no business
 * meaning belongs in `platform` (same rule as every other fixture in this
 * package).
 */
import type { Sql } from "postgres";

import type { OrgScopedContext } from "../../../src/application/org-scoped-context.js";
import { runOrgScopedQuery } from "../../../src/infrastructure/postgres-org-scoped-repository.js";

export interface FixtureWidget {
  readonly id: string;
  readonly note: string;
}

export class FixtureWidgetRepository {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  /**
   * Structurally impossible to call without an org-scoped context —
   * `context: OrgScopedContext` (not `Context`) means a caller holding
   * only a platform-scoped `Context` (`organizationId: string | null`)
   * gets a compile error here, not a runtime surprise inside this method.
   */
  async list(context: OrgScopedContext): Promise<readonly FixtureWidget[]> {
    return runOrgScopedQuery(this.#sql, context, async (tx) => {
      const rows = await tx<{ id: string; note: string }[]>`
        SELECT id, note FROM tenant_fixture.widgets ORDER BY note
      `;
      return rows;
    });
  }
}
