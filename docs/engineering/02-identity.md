# Engineering Blueprint — M1: Identity Core

Epics E05 (Tenancy), E06 (Auth). Standards: [00-OVERVIEW.md](00-OVERVIEW.md).
Tenancy leads (Sequencing Rule 2). Design sources: Architecture §16, §19–20;
DB §4–5; API §3–6.

---

## E05 — Tenancy Module `@corestack/tenancy` (M1, 30 tasks, ~44d)

**Goal:** organizations, memberships, invitations — the platform's unit of
tenancy — with the module template every later module copies.

### F5.1 Module Skeleton & Domain

| ID      | Task — Description                                                                                                                   | Cat | Pri | Deps    | Cx/Est  | Acceptance criteria & subtasks                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | --- | --- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E05-T01 | Module scaffold — package per Architecture §45 layout, lifecycle factory (E03-T20), exports map, glossary stub                       | INF | P0  | E03-T21 | S/1d    | Boots in fixture composition; boundary lint green; **this scaffold becomes the documented module template**                                                                                                                     |
| E05-T02 | `Organization` aggregate — name/slug rules, kind (personal/team), status machine (active→suspended→pending_deletion→purged), version | DOM | P0  | T01     | M/2d    | Invariants: slug format, legal status transitions only, personal orgs undeletable-while-sole-login constraints deferred to auth link. Sub: .1 entity+VOs; .2 status machine; .3 events (`organization.created/updated/deleted`) |
| E05-T03 | `Membership` entity — baseline role (owner/admin/member), status, join semantics                                                     | DOM | P0  | T02     | S/1d    | Invariants: role from closed set; events `member.joined/updated/removed`                                                                                                                                                        |
| E05-T04 | `Invitation` entity — email-addressed, single-use token (hash-only), expiry, revocation, never-owner rule (API §5)                   | DOM | P0  | T02     | M/2d    | Invariants: expiry enforced, accepted/revoked terminal, raw token never stored                                                                                                                                                  |
| E05-T05 | Ubiquitous-language glossary — organization/membership/invitation definitions, anti-terms (team/workspace) per Architecture §5       | DOC | P1  | T02     | XS/0.5d | Glossary complete; terms match code identifiers                                                                                                                                                                                 |

### F5.2 Application Layer — Organizations

| ID      | Task — Description                                                                                                   | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | ---------------------------------------------------------------------------------------------------------- |
| E05-T06 | Ports — `OrganizationRepository`, `MembershipRepository`, `InvitationRepository` (org-scoped signatures per E03-T31) | APP | P0  | T02–T04      | M/2d   | Ports in domain terms; contract suites declared (E04-T01)                                                  |
| E05-T07 | `CreateOrganization` — team org creation; creator becomes owner membership atomically                                | APP | P0  | T06          | S/1d   | AC: org+owner membership in one UoW; events emitted; slug collision → ConflictError                        |
| E05-T08 | `CreatePersonalOrganization` — auto-created on user registration (consumes `user.registered` event)                  | APP | P0  | T07, E03-T14 | S/1d   | Idempotent on event replay; kind=personal                                                                  |
| E05-T09 | `GetOrganization` / `ListMyOrganizations` — read use cases with membership summaries                                 | APP | P0  | T06          | S/1d   | Cross-org read → NotFound (isolation suite)                                                                |
| E05-T10 | `UpdateOrganization` — name/slug with optimistic version; slug-change warning surfaced in DTO                        | APP | P1  | T07          | S/1d   | Stale version → ConflictError                                                                              |
| E05-T11 | `DeleteOrganization` + `RestoreOrganization` — two-phase (pending_deletion + purge_after; DB §5)                     | APP | P0  | T07, E03-T33 | M/2d   | Restore within window; purge job scheduling; events. Sub: .1 delete; .2 restore; .3 purge fan-out emission |
| E05-T12 | `TransferOwnership` — explicit command, old owner→admin, audited (API §5)                                            | APP | P1  | T07          | S/1d   | Only current owner; target must be active member                                                           |
| E05-T13 | Tenancy purge handler — deletes module's own org data on `organization.purge_requested`                              | APP | P1  | T11          | S/1d   | Idempotent; completion tracked (E03-T33)                                                                   |

### F5.3 Application Layer — Members & Invitations

| ID      | Task — Description                                                                                           | Cat | Pri | Deps     | Cx/Est | Acceptance criteria & subtasks                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------ | --- | --- | -------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| E05-T14 | `ListMembers` — filter status/role, sort joinedAt, cursor pagination                                         | APP | P0  | T06      | S/1d   | Pagination per API §22; filters allowlisted                                                                      |
| E05-T15 | `UpdateMemberRole` — baseline role change with **sole-owner guard** (version-bump race protection per DB §5) | APP | P0  | T06      | M/2d   | Concurrent demote-last-owner race loses deterministically (tested with induced race); `tenancy/sole_owner` error |
| E05-T16 | `RemoveMember` — permissioned removal + self-removal-as-right (API §5); sole-owner guard                     | APP | P0  | T15      | S/1d   | Emits `member.removed`; self-leave path bypasses permission but not guard                                        |
| E05-T17 | `InviteMember` — pending-uniqueness (re-invite resends), token issue, notification event                     | APP | P0  | T04, T06 | M/2d   | One pending per (org,email); raw token only in event payload for mail; expiry configurable                       |
| E05-T18 | `RevokeInvitation` / `ListInvitations`                                                                       | APP | P1  | T17      | S/1d   | History rows retained (DB §17)                                                                                   |
| E05-T19 | `PreviewInvitation` — public safe-subset read by token (API §5)                                              | APP | P1  | T17      | S/1d   | No org internals leaked; invalid/expired indistinguishable (NotFound)                                            |
| E05-T20 | `AcceptInvitation` — join flow incl. invited-before-registration composition with auth (Sequencing Rule 2)   | APP | P0  | T17      | M/2d   | Single-use enforced in consuming tx; email match required; membership created with invited role                  |

### F5.4 Postgres Adapter

| ID      | Task — Description                                                                                            | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | ------------------------------------------------------------------------------------------------------------- |
| E05-T21 | Tenancy schema migrations — organizations/memberships/invitations per DB §5 incl. PUX patterns + RLS policies | ADP | P0  | T06, E03-T30 | M/2d   | Migration review checklist; RLS on all three tables                                                           |
| E05-T22 | Repository implementations — all three repos on Drizzle base (E03-T40)                                        | ADP | P0  | T21          | L/3d   | All port contract suites green vs Testcontainers pg. Sub: .1 org repo; .2 membership repo; .3 invitation repo |
| E05-T23 | Isolation + authz suites wiring — E04-T05/T06 registered for every tenancy use case                           | SEC | P0  | T22          | M/2d   | Suites green and CI-gating; matrix complete (no undeclared cases)                                             |

### F5.5 HTTP Interface

| ID      | Task — Description                                                                                   | Cat | Pri | Deps                  | Cx/Est | Acceptance criteria & subtasks                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------- | --- | --- | --------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| E05-T24 | Tenancy Zod schemas + route definitions — API §5 endpoint set, transport-neutral defs + Hono binding | API | P0  | E14-T01..T05, T07–T20 | L/3d   | All §5 endpoints bound; 422/error-code mapping snapshot; x-permission tags. Sub: .1 org routes; .2 member routes; .3 invitation routes |
| E05-T25 | Public invitation endpoints — preview/accept with hard rate limits (API §15 unauthenticated tier)    | API | P0  | T24                   | S/1d   | Per-IP limits verified in binding tests                                                                                                |

### F5.6 Module Completion

| ID      | Task — Description                                                                                         | Cat | Pri | Deps    | Cx/Est  | Acceptance criteria & subtasks                                    |
| ------- | ---------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------- | ----------------------------------------------------------------- |
| E05-T26 | Tenancy threat model — STRIDE pass over invitation/membership flows (module quality gate, Architecture §8) | SEC | P0  | T20     | M/2d    | Documented; each identified threat mapped to a test or mitigation |
| E05-T27 | Module reference docs — use-case reference, config reference, adapter guide from template                  | DOC | P0  | T24     | M/2d    | Per APP-category standard for all use cases                       |
| E05-T28 | Tenancy `/testing` subpath — fakes + fixtures for adopters (E04-T08/T09 extensions)                        | TST | P1  | T22     | S/1d    | Adopter-facing fakes contract-tested                              |
| E05-T29 | Module template extraction — document the scaffold as the canonical module template incl. checklist        | DOC | P1  | T01–T27 | S/1d    | Template doc used by E06 onward; deltas fed back                  |
| E05-T30 | Tenancy 0.1 release                                                                                        | REL | P0  | all     | XS/0.5d | Published with provenance; quickstart smoke passes                |

---

## E06 — Auth Module `@corestack/auth` (M1, 44 tasks, ~68d)

**Goal:** accounts, sessions, credentials, OAuth, MFA, API keys — the
security-critical module; ASVS L2 alignment tracked task-by-task.

### F6.1 Domain

| ID      | Task — Description                                                                                                        | Cat | Pri | Deps    | Cx/Est | Acceptance criteria & subtasks                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------ | --------------------------------------------------------------------------------------- |
| E06-T01 | Module scaffold from template (E05-T29)                                                                                   | INF | P0  | E05-T29 | S/1d   | Boots in composition; lint green                                                        |
| E06-T02 | `UserAccount` aggregate — email (normalized VO), status machine (active/suspended/deleted), verification state            | DOM | P0  | T01     | M/2d   | Invariants + events (`user.registered/suspended/deleted`); email VO property-tested     |
| E06-T03 | `Session` entity — token policy (256-bit, hash-only), sliding + absolute expiry, revocation, mfa_verified step-up state   | DOM | P0  | T02     | M/2d   | Expiry math deterministic under FixedClock; raw token never on entity                   |
| E06-T04 | Credential VOs — password policy (length, breach-list hook), argon2id params object, reset/verification token policies    | DOM | P0  | T02     | M/2d   | Policy violations produce ValidationError with field detail; params match OWASP current |
| E06-T05 | `OAuthIdentity` + account-linking rules — verified-email match or explicit confirmation (Architecture §16 takeover guard) | DOM | P0  | T02     | M/2d   | Linking decision table fully unit-tested (6 cases)                                      |
| E06-T06 | MFA domain — TOTP enrollment states, recovery-code set semantics (single-use, regenerate-invalidates)                     | DOM | P0  | T02     | M/2d   | Unconfirmed-enrollment expiry; code single-use invariant                                |
| E06-T07 | `ApiKey` entity — prefix scheme (`csk_live_`), scopes⊆creator rule, expiry/revocation                                     | DOM | P0  | T02     | S/1d   | Scope-escalation attempt → ForbiddenError                                               |

### F6.2 Application — Registration & Credentials

| ID      | Task — Description                                                                                                                | Cat | Pri | Deps         | Cx/Est | Acceptance criteria & subtasks                                                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E06-T08 | Ports — UserAccountRepo, SessionRepo, CredentialRepo, TokenRepos, OAuthIdentityRepo, ApiKeyRepo, `PasswordHasher`, `TotpProvider` | APP | P0  | T02–T07      | M/2d   | Contract suites declared for all                                                                                                                                           |
| E06-T09 | `Register` — account + verification token + `user.registered` event (drives personal org E05-T08); neutral 202 semantics          | APP | P0  | T08          | M/2d   | Duplicate email: same outward behavior (anti-enumeration tested); invitation-token variant links to E05-T20                                                                |
| E06-T10 | `VerifyEmail` — token consumption, activation                                                                                     | APP | P0  | T09          | S/1d   | Single-use in tx; expired → NotFound                                                                                                                                       |
| E06-T11 | `Login` — credential check (constant-time), rate-limit port integration (per-IP + per-email), MFA challenge branch                | APP | P0  | T08, E02-T08 | L/3d   | AC: failure timing uniform (measured); limits per API §17 defaults; challenge state short-lived + cookie-scoped. Sub: .1 credential path; .2 limiter wiring; .3 MFA branch |
| E06-T12 | `CompleteMfaLogin` — TOTP or recovery code completes challenge                                                                    | APP | P0  | T11, T06     | M/2d   | Recovery code burns; drift window ±1 step; replay of used code fails                                                                                                       |
| E06-T13 | `Logout` / `RevokeSession` / `RevokeAllSessions` / `ListSessions`                                                                 | APP | P0  | T11          | M/2d   | Revocation immediate (cache-bypass rule Architecture §12); events emitted                                                                                                  |
| E06-T14 | `ForgotPassword` / `ResetPassword` — neutral responses, single-use token, revoke-all-sessions on reset                            | APP | P0  | T08          | M/2d   | Anti-enumeration; issuance throttle per-email (DB §4 index)                                                                                                                |
| E06-T15 | `ChangePassword` — step-up required; rehash-on-verify if params outdated                                                          | APP | P0  | T14, T22     | S/1d   | Param-upgrade path tested                                                                                                                                                  |
| E06-T16 | `ChangeEmail` — verify-new-then-switch two-step (API §4)                                                                          | APP | P1  | T10          | M/2d   | Old email notified (event); switch atomic                                                                                                                                  |
| E06-T17 | `SuspendUser` / `UnsuspendUser` — admin ops; suspend revokes all sessions synchronously (Architecture §16 "now")                  | APP | P0  | T13          | S/1d   | Session kill verified in same tx; events for audit                                                                                                                         |
| E06-T18 | `DeleteMyAccount` + purge handler — two-phase, sole-owner block (API §4), auth data purge on fan-out                              | APP | P1  | T17, E05-T15 | M/2d   | `tenancy/sole_owner` propagated; purge idempotent                                                                                                                          |

### F6.3 Application — Sessions & Step-up

| ID      | Task — Description                                                                                           | Cat | Pri | Deps         | Cx/Est  | Acceptance criteria & subtasks                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------ | --- | --- | ------------ | ------- | -------------------------------------------------------------------------------------------------------------- |
| E06-T19 | `ValidateSession` — the hot path: hash lookup, expiry/revocation checks, sliding refresh, Context production | APP | P0  | T11          | M/2d    | p95 budget benchmark registered (E04-T13, ≤5 ms with cache); returns Context per E03-T32                       |
| E06-T20 | Session cache integration — version-stamped keys, revocation bypass rules (Architecture §12)                 | APP | P1  | T19, E02-T07 | M/2d    | Revocation effective ≤ TTL cross-node, immediate same-node; security-critical revocations synchronous (tested) |
| E06-T21 | `GetCurrentSession` (`/auth/session` bootstrap) — session + user summary DTO                                 | APP | P0  | T19          | XS/0.5d | No sensitive fields in DTO (snapshot-reviewed)                                                                 |
| E06-T22 | `StepUp` + recent-auth policy — uniform step-up check consumed by all marked use cases (API §3.1)            | APP | P0  | T19          | M/2d    | `auth/step_up_required` flow; window configurable; mfa & password variants                                     |

### F6.4 Application — OAuth

| ID      | Task — Description                                                                                                                         | Cat | Pri | Deps     | Cx/Est | Acceptance criteria & subtasks                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --- | --- | -------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| E06-T23 | OAuth flow engine — auth-code+PKCE, state binding to pre-auth cookie, provider registry port                                               | APP | P0  | T05, T08 | L/4d   | State/PKCE tampering tests fail closed; nonce validated (OIDC). Sub: .1 start; .2 callback; .3 state store; .4 provider port |
| E06-T24 | Reference providers — Google, GitHub, generic OIDC                                                                                         | ADP | P0  | T23      | M/2d   | Each passes provider contract suite (mock IdP); generic OIDC discovery-doc driven                                            |
| E06-T25 | `LinkOAuthIdentity` / `UnlinkOAuthIdentity` — linking per T05 rules; unlink blocked if it strands the account (no password, sole identity) | APP | P1  | T23      | M/2d   | Strand-guard tested; link requires step-up when adding to existing account                                                   |

### F6.5 Application — MFA & API Keys

| ID      | Task — Description                                                                                                            | Cat | Pri | Deps               | Cx/Est | Acceptance criteria & subtasks                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------------ | ------ | ------------------------------------------------------------------------------------- |
| E06-T26 | `EnrollTotp` / `ConfirmTotp` / `DisableTotp` — secret encrypted (E02-T09), one-render provisioning, step-up on enroll/disable | APP | P0  | T06, T22, E02-T09  | M/2d   | Secret never logged/returned post-enroll; unconfirmed expiry sweeper job              |
| E06-T27 | Recovery codes — generate/regenerate (invalidate prior), one-render, hashed storage                                           | APP | P0  | T26                | S/1d   | Count/entropy per policy; regeneration audit event                                    |
| E06-T28 | API key lifecycle — create (one-render, scopes⊆creator), list, revoke; last-used throttled update (DB §4)                     | APP | P0  | T07, E05 contracts | M/2d   | Key auth path produces org-scoped Context; revoked key rejected immediately           |
| E06-T29 | `AuthenticateApiKey` — bearer path: prefix parse, hash lookup, scope→permission mapping into Context                          | APP | P0  | T28                | M/2d   | Benchmark registered; session-only endpoints reject keys (`auth/api_key_not_allowed`) |

### F6.6 Postgres Adapter

| ID      | Task — Description                                                                                   | Cat | Pri | Deps          | Cx/Est | Acceptance criteria & subtasks                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------- | --- | --- | ------------- | ------ | ------------------------------------------------------------------------------------------------ |
| E06-T30 | Auth schema migrations — all §4 tables, PUX email pattern, RLS where org-scoped (api_keys)           | ADP | P0  | T08, E03-T30  | M/2d   | Append/immutability grants for token tables reviewed                                             |
| E06-T31 | Repositories — account/credential/session/token repos                                                | ADP | P0  | T30           | L/4d   | Contract suites green. Sub: .1 accounts+credentials; .2 sessions; .3 tokens; .4 oauth identities |
| E06-T32 | ApiKey + MFA repositories                                                                            | ADP | P0  | T30           | M/2d   | Contract suites green; encrypted-column round-trip                                               |
| E06-T33 | `PasswordHasher` adapter — argon2id with configured params + rehash detection                        | ADP | P0  | T04           | S/1d   | Params from config; timing test sanity                                                           |
| E06-T34 | Sweeper jobs — expired sessions/tokens/unconfirmed enrollments cleanup (soft-revoke→sweep per DB §4) | ADP | P1  | T31, E11 port | S/1d   | Sweep respects audit-before-delete rule                                                          |

### F6.7 HTTP Interface

| ID      | Task — Description                                                                             | Cat | Pri | Deps                 | Cx/Est | Acceptance criteria & subtasks                                                                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------- | --- | --- | -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E06-T35 | Session/credential endpoints — API §3 register→logout set with cookie handling, CSRF (E14-T04) | API | P0  | T09–T22, E14-T01..05 | L/4d   | Cookie attributes exact (HttpOnly/Secure/SameSite); binding tests for every error code. Sub: .1 register/verify; .2 login/mfa/logout; .3 password flows; .4 session mgmt |
| E06-T36 | OAuth endpoints — start/callback redirects, error mapping to safe UX states                    | API | P0  | T23–T24              | M/2d   | Open-redirect prevention tested (allowlisted return-to)                                                                                                                  |
| E06-T37 | MFA + step-up endpoints — enroll/confirm/disable/recovery + `/auth/step-up`                    | API | P0  | T26–T27, T22         | M/2d   | One-render responses verified non-repeatable                                                                                                                             |
| E06-T38 | API key endpoints — org-scoped CRUD per API §3.2                                               | API | P0  | T28                  | S/1d   | Permission tags; one-render create                                                                                                                                       |
| E06-T39 | `/me` endpoints — profile, email change, delete, export-job stub (API §4)                      | API | P1  | T16, T18             | M/2d   | Export enqueues job + notification path documented                                                                                                                       |

### F6.8 Module Completion

| ID      | Task — Description                                                                                              | Cat | Pri | Deps        | Cx/Est | Acceptance criteria & subtasks                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------- | --- | --- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| E06-T40 | Auth threat model — full STRIDE + ASVS L2 checklist mapping per control                                         | SEC | P0  | T35         | L/3d   | Every ASVS L2 auth control: implemented / N-A-with-reason; gaps ticketed                                                   |
| E06-T41 | Adversarial test pass — enumeration, fixation, replay, timing, brute-force, token-leak scenarios                | SEC | P0  | T40         | L/4d   | Listed scenarios all have failing-closed tests. Sub: .1 enumeration; .2 session fixation/replay; .3 timing; .4 brute force |
| E06-T42 | Isolation + authz matrix wiring for auth                                                                        | SEC | P0  | T31–T32     | M/2d   | Suites gating                                                                                                              |
| E06-T43 | Auth module docs — use-case reference, security guide (cookie vs bearer, step-up integration), config reference | DOC | P0  | T35–T39     | L/3d   | Quickstart: register→login→org flow < 1 h validated by naive-reader test (M1 exit)                                         |
| E06-T44 | Auth 0.1 release + M1 exit review — publish, internal security self-review sign-off                             | REL | P0  | all E05/E06 | M/2d   | M1 exit criteria (Overview §6) all check                                                                                   |
