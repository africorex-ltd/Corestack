/**
 * Placeholder record shape — **not** the `Membership` aggregate. See the
 * identical caveat on `OrganizationRecord` (./organization.ts): the real
 * aggregate (role/status invariants, join semantics) ships in E05-T03.
 */
export interface MembershipRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: "owner" | "admin" | "member";
  readonly status: "active" | "removed";
  readonly joinedAt: Date;
}
