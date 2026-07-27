# Guide: Plugin Development (Adapters, Event Consumers & Third-Party Modules)

> **Status: approved structure — adapter content lands with M2 (E18-T15),
> module content with M4.** Audience: contributors & ecosystem authors.
> Normative sources: [Architecture §24](../architecture/ARCHITECTURE.md) ("modules _are_ the
> plugin system"), [Database §13](../architecture/DATABASE.md), [API §11](../architecture/API.md).

## Table of contents & content charter

1. **The extension model** — _What belongs:_ the four extension surfaces
   (adapters, event consumers, third-party modules, use-case decoration) and
   the deliberate absence of runtime plugin loading — the security reasoning
   in two paragraphs, so ecosystem authors understand the constraint is a
   feature. A decision tree: "which surface is my idea?"
2. **Writing an adapter** — the flagship path. _Belongs:_ pick a port → read
   its TSDoc semantics → implement → **run the published contract suite**
   (the certification bar) → integration-test against real infrastructure →
   package (own npm package, peer-dep on the module). Worked end-to-end with
   a real example (a mail provider). The contract-suite lifecycle from
   E04/E18-T15 is the spine of this section.
3. **Consuming events** — _Belongs:_ subscribing via the bus port, the
   envelope contract (versions, correlation ids), idempotency obligations
   (at-least-once, the dedupe helper), org-scoping discipline for consumers,
   the event catalog pointer.
4. **Building a third-party module** — _Belongs:_ the module lifecycle
   contract (`create<X>Module`), owning a Postgres schema (naming:
   `<vendor>_<module>`, the no-cross-FK rule, RLS participation, purge
   handler), registering permissions and routes (`/x/{moduleKey}`), shipping
   migrations, meeting the module quality gate (glossary, threat model,
   contract tests, docs). Framed honestly: this is the high bar, and what it
   buys (indistinguishable-from-core tooling).
5. **Use-case decoration** — _Belongs:_ the sanctioned wrapping points for
   cross-cutting adopter concerns, with the warning about what decoration
   must never do (bypass authorization, swallow Results).
6. **Testing your extension** — _Belongs:_ using `/testing` subpath fakes,
   the isolation-suite obligations for org-scoped extensions, CI patterns
   (Testcontainers) for adapter authors.
7. **Publishing & certification** — _Belongs:_ naming conventions, semver
   expectations against the compatibility table, the registry listing process
   and certification tiers (core/verified/community), what "verified" requires
   (contract-suite proof in CI).
8. **Maintenance realities** — _Belongs:_ tracking upstream port changes
   (deprecation windows), the compatibility-table workflow, getting help in
   the ecosystem channel.
