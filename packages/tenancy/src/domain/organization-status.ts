/**
 * Organization lifecycle status — E05-T02 Section 4.
 *
 * Three states, not the four (`active`/`suspended`/`pending_deletion`/
 * `purged`) sketched in `docs/modules/tenancy-contract.md`'s forward-
 * looking two-phase-delete design. That contract doc's restore-window
 * flow (E05-T13's purge protocol) is a real future decision, not modeled
 * by this aggregate yet — tracked as an open reconciliation in
 * `docs/modules/organization-domain.md`'s non-goals rather than silently
 * assumed one way or the other.
 */
export const OrganizationStatus = {
  Active: "ACTIVE",
  Suspended: "SUSPENDED",
  Deleted: "DELETED",
} as const;

export type OrganizationStatus = (typeof OrganizationStatus)[keyof typeof OrganizationStatus];

/**
 * Legal transitions (E05-T02 Section 4). `DELETED` has no outgoing
 * entries — it is terminal: every transition attempted *from* `DELETED`
 * is illegal, including back to `ACTIVE`. There are deliberately no
 * self-transitions (e.g. `SUSPENDED` → `SUSPENDED`): calling `suspend()`
 * on an already-suspended organization is an invalid transition, not a
 * no-op — see Section 7's "suspend/reactivate must change state".
 */
const LEGAL_TRANSITIONS: Readonly<Record<OrganizationStatus, readonly OrganizationStatus[]>> = {
  [OrganizationStatus.Active]: [OrganizationStatus.Suspended, OrganizationStatus.Deleted],
  [OrganizationStatus.Suspended]: [OrganizationStatus.Active, OrganizationStatus.Deleted],
  [OrganizationStatus.Deleted]: [],
};

export function isLegalOrganizationStatusTransition(
  from: OrganizationStatus,
  to: OrganizationStatus,
): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}
