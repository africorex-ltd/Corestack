/**
 * Placeholder record shape — **not** the `Invitation` aggregate. The real
 * aggregate (single-use token hashing, expiry, the never-owner rule) ships
 * in E05-T04, following the same pattern `Organization` (./organization.ts,
 * E05-T02) established. `tokenHash` here is a bare field, not a hashing
 * scheme — that choice belongs to E05-T04, not this scaffold.
 */
export interface InvitationRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: "admin" | "member";
  readonly tokenHash: string;
  readonly status: "pending" | "accepted" | "revoked" | "expired";
  readonly expiresAt: Date;
  readonly createdAt: Date;
}
