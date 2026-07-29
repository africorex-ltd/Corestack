/**
 * Marker for a repository that legitimately queries across every
 * organization without per-call org scoping — e.g. platform-wide admin
 * tooling, cross-tenant reporting, or a migration/backfill utility.
 * Implementing this interface is an explicit, reviewable opt-out of the
 * org-scoping discipline every other repository in this codebase follows
 * (`OrgScopedContext`/`runOrgScopedQuery`, E03-T31).
 *
 * Architecture-fitness-enforced (ADR-0021,
 * `packages/architecture-tests/test/tenant-isolation.test.mjs`): any
 * `*repository*.ts` source file that doesn't reference `OrgScopedContext`
 * must reference `GlobalRepository`, and any file referencing
 * `GlobalRepository` must also cite an `ADR-####` in the same file — so a
 * cross-tenant repository is always a deliberate, documented decision,
 * never an accidental omission of org scoping.
 */
export interface GlobalRepository {
  /**
   * Never read at runtime — purely a type-level marker the fitness rule
   * greps for by name. A brand property (rather than an empty interface)
   * keeps this from being structurally satisfied by an unrelated type
   * that happens to have no members.
   */
  readonly __globalRepository: true;
}
