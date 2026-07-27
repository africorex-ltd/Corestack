# Guide: Theming & UI Customization

> **Status: approved structure — content lands with M4** (reference app +
> notifications templates). Audience: adopters.

**Read this first: CoreStack is headless.** The platform ships no UI kit, no
component library, and no theme engine — deliberately and permanently
([Vision §9](../product/VISION.md) out-of-scope list). Your product's look and
feel is yours; CoreStack never renders a pixel of it. This guide exists
because "how do I theme it?" is a predictable question that deserves a real
answer with reasons rather than a missing page.

## Table of contents & content charter

1. **What is and isn't themeable — the honest map** — _What belongs:_ a
   two-column table: _yours entirely_ (all product UI, auth pages, dashboards
   — CoreStack is API + SDK underneath) vs _CoreStack-rendered surfaces that
   support customization_ (transactional emails; the reference app, if you
   fork it as a starting point). The reasoning link: why headless is the
   ownership promise, in three sentences.
2. **Theming transactional emails** — the real content. _Belongs:_ the
   notifications module's template registry model (code-adjacent, typed
   variables), layout customization (logo, colors, footer, sender identity),
   overriding shipped templates (invitation, reset, security notices) vs
   adding your own, text/HTML alternatives, per-locale variants, and the
   guardrails (security-notice templates: what you may restyle but not
   remove). Preview/testing workflow with the capturing mail fake.
3. **Reference app as a starting point** — _Belongs:_ if you fork
   `apps/reference-nextjs` as your scaffold: its design-token structure,
   dark-mode approach, swapping the token set — plus the honest caveat that a
   fork of the reference app is _yours_ thereafter (it's a teaching artifact,
   not a maintained template — the vision's anti-starter-kit position applies
   to it too, and this section says so explicitly).
4. **In-app notification content** — _Belongs:_ the inbox payload/template
   split — CoreStack stores structured payloads, _your_ components render
   them; patterns for mapping template keys to your design system.
5. **White-labeling checklist** — _Belongs:_ the multi-tenant branding
   question (per-org logos/colors in _your_ UI and in email variables),
   what's adopter domain (all of it) and the variables the email layer
   exposes to make it easy.
6. **What we'll never ship** — _Belongs:_ the boundary restated for the
   record: no UI kit, no theme marketplace, no server-rendered admin panel —
   with links to the vision reasoning, so "no" always comes with "why."
