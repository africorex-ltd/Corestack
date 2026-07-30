import type { Context } from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";

import type { Organization } from "../src/domain/organization.js";
import type { OrganizationSlug } from "../src/domain/organization-slug.js";
import type { OrganizationRepository } from "../src/application/organization-repository.js";

/**
 * In-memory `OrganizationRepository` (E05-T08) — a real, reusable
 * implementation of the port for the workflow harness, not a per-test
 * throwaway fake with a single settable field (contrast the
 * `Fake*Repository` classes in `test/application/*.test.ts`, which exist
 * only to control one use case's inputs in isolation). This one stores
 * actual state across an entire multi-use-case workflow.
 *
 * Copy-on-write storage (Section 3: "use immutable storage where
 * practical"): `save` replaces `#organizations`/`#slugIndex` with new
 * `Map` instances rather than mutating in place, so any array previously
 * returned by `listForContext` stays valid — the aggregate itself is not
 * cloned (no clone method exists on `Organization`, and none is needed:
 * callers only ever get it back through `findById`, never a mutable
 * reference to internal storage).
 *
 * `listForContext` returns organizations whose id matches
 * `context.organizationId` — a minimal, workable choice; this package's
 * own `organization-repository.ts` already flags whether `organizations`
 * should be scoped by its own id or by membership-join as an open
 * question for E05-T21, not resolved here.
 */
export class InMemoryOrganizationRepository implements OrganizationRepository {
  #organizations: ReadonlyMap<string, Organization> = new Map();
  #slugIndex: ReadonlyMap<string, string> = new Map();

  async findById(_context: OrgScopedContext, organizationId: string): Promise<Organization | null> {
    return this.#organizations.get(organizationId) ?? null;
  }

  async listForContext(context: OrgScopedContext): Promise<readonly Organization[]> {
    const organization = this.#organizations.get(context.organizationId);
    return organization === undefined ? [] : [organization];
  }

  async existsBySlug(_context: Context, slug: OrganizationSlug): Promise<boolean> {
    return this.#slugIndex.has(slug.value);
  }

  async save(_context: Context, organization: Organization): Promise<void> {
    this.#organizations = new Map(this.#organizations).set(organization.id.value, organization);
    this.#slugIndex = new Map(this.#slugIndex).set(organization.slug.value, organization.id.value);
  }
}
