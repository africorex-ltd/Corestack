/**
 * Placeholder record shape — **not** the `Membership` aggregate. The real
 * aggregate (role/status invariants, join semantics) ships in E05-T03,
 * following the same pattern `Organization` (./organization.ts, E05-T02)
 * established: value objects, explicit transition methods, and
 * `pullDomainEvents()`/`clearDomainEvents()` — not a bare record.
 */
export interface MembershipRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: "owner" | "admin" | "member";
  readonly status: "active" | "removed";
  readonly joinedAt: Date;
}
