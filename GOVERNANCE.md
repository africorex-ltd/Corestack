# CoreStack Governance

This document defines how decisions are made and who makes them. It is
deliberately simple now and designed to grow; changing it requires an RFC.

## Roles

| Role                         | Who                                                   | Rights & duties                                                                               |
| ---------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Contributor**              | anyone with a merged PR                               | Credited in release notes; DCO sign-off on all commits                                        |
| **Triager**                  | granted after sustained, quality triage participation | Label/close/reopen issues, run the triage rotation                                            |
| **Module maintainer**        | owns one or more modules (CODEOWNERS)                 | Reviews + merges in their area; keeps threat model & docs current; upholds category standards |
| **Core maintainer**          | small set across the whole platform                   | All modules + release + security response; approves ADRs; mentors module maintainers          |
| **Founder / BDFL (interim)** | the project founder                                   | Tie-breaks, vision/scope guardianship, governance changes — see sunset clause                 |

**Becoming a maintainer:** nominated by an existing maintainer after a track
record of merged work and reviews in the area; consensus of core maintainers
confirms; the contribution-ladder doc lists objective criteria. **Stepping
down** is honorable and public (emeritus list); **removal** (inactivity > 6
months or conduct) is by core-maintainer consensus.

## Decision-making

1. **Default: lazy consensus.** A change with an approving review and no
   objections within the review window proceeds. Silence is consent for
   routine work.
2. **RFC track** (substantial: new modules, new ports, public-API changes,
   governance): public RFC → 7-day final-comment period → accepted by core
   maintainer consensus. Vision/scope conflicts are decided against the
   written vision — changing the vision is itself an RFC.
3. **ADR track** (architectural, hard-to-reverse): ADR PR reviewed by core
   maintainers; accepted ADRs bind future work (superseding requires a new ADR).
4. **Ties and deadlocks:** founder decides, in writing, with rationale, in
   public. Founder overrides of maintainer consensus are expected to be rare
   and are always accompanied by a written ADR/RFC comment.
5. **Security decisions** run through the private security process first
   (SECURITY.md); disclosure timing is decided by the security rotation +
   founder, then everything becomes public.

**Sunset clause:** the interim BDFL role converts to an elected steering group
(3–5 seats, maintainer-elected) at 1.0 + 12 months or 5 active core
maintainers, whichever comes first — written here so the transition is a
promise, not a hope (vision §15: generational sustainability).

## Scope guardianship

The vision's out-of-scope list (VISION.md §9) and the architecture's refusals
are enforceable in triage: any maintainer may close a request citing them;
reopening requires the RFC track. "No, with a link to why" is respectful;
scope creep is not.

## Conduct

The Code of Conduct applies in all project spaces. Enforcement: module/core
maintainers for routine moderation; a designated conduct contact (listed in
CODE_OF_CONDUCT.md) for reports involving maintainers themselves. Conduct
decisions about maintainers are made by the core maintainer group excluding
anyone involved.

## Assets & continuity

The GitHub org, npm org, domain, and signing credentials are held with ≥ 2
core-maintainer access (no single point of failure); the private ops repo
documents custody. If the project is abandoned (no maintainer activity for 12
months), the last maintainers commit to transferring assets to a willing
successor or a foundation rather than letting the namespace rot.
