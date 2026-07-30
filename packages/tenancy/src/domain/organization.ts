/**
 * Placeholder record shape — **not** the `Organization` aggregate.
 *
 * The real aggregate (name/slug format rules, `kind` invariant, the
 * `active → suspended → pending_deletion → purged` status machine) ships
 * in E05-T02 per docs/modules/tenancy-contract.md. This interface exists
 * solely so E05-T01's repository ports (Section 7) have a concrete return
 * type instead of `unknown`, and intentionally carries zero behavior or
 * invariant enforcement — that is exactly the line E05-T01 must not cross.
 */
export interface OrganizationRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly kind: "personal" | "team";
  readonly status: "active" | "suspended" | "pending_deletion" | "purged";
  readonly createdAt: Date;
}
