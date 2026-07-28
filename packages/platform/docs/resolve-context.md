# Component Spec — Context Resolution

- **Task:** E03-T32 · **Status:** Implemented · **Category:** APP (application layer, no I/O beyond the injected `MembershipLookup`)
- **ADR references:** ADR-0008 (pooled multi-tenancy, layered enforcement — this is layer 2 of 4)
- **Design docs:** [Architecture §20.2](../../../docs/architecture/ARCHITECTURE.md) ("request `Context` carries the server-resolved org — never client-asserted")

## Contract

**Purpose:** turn an already-authenticated `Actor` plus a _claimed_
organization id (untrusted — from a header, path segment, wherever an
interface binding reads it) into a trustworthy `Context`, by verifying the
claim against a `MembershipLookup` port before it becomes part of anything
downstream code trusts.

**Public surface:**

| Export                                         | Purpose                                                         |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `resolveContext(input, membershipLookup, ids)` | The one resolution function → `Result<Context, ForbiddenError>` |
| `MembershipLookup` (port)                      | `isActiveMember(userId, organizationId): Promise<boolean>`      |

**Explicitly not this function's job:** authenticating the actor (session
cookie / API key parsing is the auth module's job, E06); extracting the
claimed org from an HTTP request (that's the interface binding, E14 — this
function is the framework-agnostic piece E14 calls _after_ extraction).

## Failure modes

| Failure                                                      | Behavior                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claimed org, actor is not an active member                   | `ForbiddenError` — **identical** message whether the org doesn't exist or the actor simply isn't a member (Architecture §20: cross-tenant access must look indistinguishable from non-existence, never letting an attacker distinguish "wrong id" from "not yours" by probing) |
| Claimed org paired with a system actor (`actor.id === null`) | `ForbiddenError` — a misuse case: system contexts are built via `systemContext()` directly and never carry a claimed org through this path                                                                                                                                     |
| No claim at all (`claimedOrganizationId: null`)              | Not a failure — resolves a platform-scoped `Context` with `organizationId: null`                                                                                                                                                                                               |

## Retry / timeout / cancellation

None from this function — it calls `membershipLookup.isActiveMember` once
and returns. A real Postgres-backed `MembershipLookup` (arrives with the
tenancy module) owns any resilience concerns for its own query; this
function's contract is intentionally just `Promise<boolean>`.

## Concurrency guarantees

Fully pure with respect to its own state (no caching — see Security
below for why); safe to call concurrently for any number of requests.

## Performance

One membership lookup per request that carries an org claim — the
dominant cost is whatever the real adapter's query costs, not this
function. No caching is added _here_; the kernel's `Cache` port with
version-stamped invalidation (Architecture §12) is the sanctioned place
for a future performance layer, deliberately not built speculatively into
this function.

## Security considerations — the reason this component exists

- **Never client-asserted:** the whole point. An interface binding that
  skipped this function and trusted a header directly would defeat ADR-
  0008's layer 2 entirely — this function is the one place that decision
  is enforced, and every future HTTP binding (E14) must route through it.
- **Uniform failure shape:** deliberately one `ForbiddenError` message for
  every "no" — non-member and non-existent-org are indistinguishable by
  design, closing the org-id enumeration side-channel.
- **No implicit trust for any actor type:** `api_key` actors go through
  the identical membership check as `user` actors — an API key does not
  get to skip the check just because it's "probably a backend."

## Observability

None added in this component (a single port call, no I/O of its own to
instrument); the interface binding layer (E14) that calls this function
is where request-level tracing/logging attaches, using the correlation id
this function threads into the resolved `Context`.

## Testing

8 tests: no-claim → platform-scoped context; verified membership → org
resolved; **the forged-org-header case** (task AC) — a claim the actor
isn't a member of is rejected; the identical-failure-shape property
(non-member vs. nonexistent-org produce the exact same error message,
asserted directly, not just "both fail"); system-actor misuse rejected;
a removed/suspended membership (simply absent from the active set)
rejected; correlation/causation/locale propagation into the resolved
`Context`; and `api_key` actors going through the same check as `user`.

## Design rationale

Why return `Result` rather than throw? A forged or stale org claim is a
routine, expected occurrence at the edge of a multi-tenant system (a user
switched orgs in another tab, a stale bookmark, an actual attack probe) —
exactly the class of "expected failure" the kernel's `Result` convention
exists for, handled by the interface binding as a normal 403 response, not
an exceptional crash.
