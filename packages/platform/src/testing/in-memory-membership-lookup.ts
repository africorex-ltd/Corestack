/**
 * In-memory `MembershipLookup` test double (E03-T32) — lets context-
 * resolution tests (and adopter tests of code built on `resolveContext`)
 * run without a real tenancy module or database.
 */

import type { MembershipLookup } from "../application/resolve-context.js";

export class InMemoryMembershipLookup implements MembershipLookup {
  readonly #activeMemberships = new Set<string>(); // "userId|organizationId"

  addActiveMember(userId: string, organizationId: string): void {
    this.#activeMemberships.add(`${userId}|${organizationId}`);
  }

  async isActiveMember(userId: string, organizationId: string): Promise<boolean> {
    return this.#activeMemberships.has(`${userId}|${organizationId}`);
  }
}
