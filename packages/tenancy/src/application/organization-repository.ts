import type { OrgScopedContext } from "@corestack/platform";

import type { OrganizationRecord } from "../domain/organization.js";

/**
 * Port only — no persistence implementation (E05-T21 builds the Postgres
 * adapter). Method signatures are provisional: `docs/modules/tenancy-
 * contract.md`'s own "RLS requirements" section flags `organizations` as
 * an open question — is it a normal org-scoped table, or does its RLS
 * policy need a membership-join condition instead, since a row *is* an
 * organization rather than something scoped *to* one? That decision
 * belongs to E05-T21, not this scaffold. `OrgScopedContext` is used here
 * to satisfy the org-scoping discipline structurally (a caller must have
 * resolved *some* organization context to call this port) without
 * pre-deciding how `organizations` itself will be scoped at the database
 * layer.
 */
export interface OrganizationRepository {
  findById(context: OrgScopedContext, organizationId: string): Promise<OrganizationRecord | null>;
  listForContext(context: OrgScopedContext): Promise<readonly OrganizationRecord[]>;
}
