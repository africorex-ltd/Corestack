# Guide: Authentication

> **Status: approved structure — content lands with M1** (blueprint E06-T43).
> Audience: adopters. Normative sources: [Architecture §16](../architecture/ARCHITECTURE.md),
> [API §3–4](../architecture/API.md). This guide teaches; those documents decide.

## Table of contents & content charter

1. **Mental model** — _What belongs:_ the five actor types (end user, session,
   API key, provider webhook, operator) and the one-paragraph explanation of
   opaque server-side sessions — why revocation-is-a-DELETE is the design
   center. One diagram: credential → session → Context.
2. **Quickstart: email + password** — _Belongs:_ the shortest path from module
   install to a working register→verify→login→logout loop, with the exact
   cookie attributes explained (HttpOnly/Secure/SameSite) and what the module
   does that you no longer have to (hashing, enumeration defense, rate
   limits). Copy-pasteable, sample-CI-verified steps.
3. **Sessions in depth** — _Belongs:_ sliding vs absolute expiry knobs, device
   listing & remote revocation UX patterns, the session cache and its
   revocation-lag bound, "suspend takes effect now" semantics.
4. **OAuth & OIDC** — _Belongs:_ provider registry configuration (Google,
   GitHub, generic OIDC), the account-linking decision table in plain
   language, the pre-registration invitation + OAuth composition, redirect
   allowlisting. _Never:_ protocol theory beyond what configuration requires.
5. **MFA & step-up** — _Belongs:_ TOTP enrollment UX flow (one-render rules),
   recovery codes, and the step-up dance end-to-end — including how the SDK
   automates `auth/step_up_required` and how to mark _your own_ use cases as
   step-up-required.
6. **API keys (machine access)** — _Belongs:_ when keys vs sessions, scope
   model (⊆ creator), prefix/one-render handling, rotation practice.
7. **Integrating with your frontend** — _Belongs:_ cookie mode + CSRF header
   via the SDK, the `/auth/session` bootstrap pattern, SSR notes for Next.js.
8. **Replacing or extending auth** — _Belongs:_ the enterprise path — bringing
   your own IdP beside CoreStack tenancy, which ports to implement, what you
   own if you do.
9. **Hardening checklist** — _Belongs:_ the pre-launch list: rate-limit
   defaults review, cookie domain scope, proxy trust, secret rotation
   schedule, the threat-model pointer. Each item links its rationale.
10. **Troubleshooting** — _Belongs:_ the top `corestack doctor` findings and
    error codes (`auth/*` registry excerpt) with causes and fixes.
