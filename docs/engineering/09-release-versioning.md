# CoreStack — Release Strategy, Version Strategy & Semantic Versioning Plan

- **Status:** Draft, awaiting founder approval
- **Date:** 2026-07-28
- **Depends on:** Architecture §7, §34, §36; Blueprint E01-F1.4, E19-F19.4

## 1. Release Strategy

- **Release unit:** the individual package (`@corestack/*` independent semver,
  ADR/Architecture §7), orchestrated by **Changesets**: PRs carry changesets →
  bot maintains a "Version Packages" PR → merging it tags + publishes.
- **Cadence:** _train model_ — a release train departs **every two weeks** if
  anything is aboard; no artificial holding of finished work, no pressure to
  ship unfinished work. Security fixes ignore the train (ship immediately).
- **Release channels:**
  - `latest` — stable releases.
  - `next` — prerelease line (`0.5.0-next.2`) cut from `main` for adopters who
    test early; automated on merge when a changeset is pending.
  - No LTS channel pre-1.0; post-1.0 the current major is the supported line
    plus security backports per SECURITY.md.
- **Every release ships:** provenance-attested npm publish (CI-only, E01-T15),
  per-package changelog, the merged OpenAPI spec artifact + spec-diff (E14-T19),
  compatibility table (E01-T17), and migration notes when schemas changed.
- **Release gates (cannot ship without):** full CI incl. isolation suite,
  contract suites, tarball smoke test, N/N+1 upgrade lane (post-M5),
  benchmark regression gate.
- **Rollback posture:** npm versions are immutable — rollback = publish a
  revert release. `deprecate` is used on broken versions with a pointer to the
  fixed one within hours, per the security runbook.

## 2. Version Strategy

- **Pre-1.0 (now):** `0.x.y` with **loudly documented semantics — minor may
  break, patch never does.** Every 0.x minor with breaks includes migration
  notes. The README, docs banner, and release notes all state this; honesty
  about instability is the vision's trust posture.
- **Path to 1.0:** a package reaches 1.0 only via the M5 freeze review
  (E19-T14): API surface reviewed export-by-export, external audit passed
  (for security-bearing packages), N/N+1 upgrade contract in CI. Planned
  first wave: `kernel`, `tenancy`, `auth`, `rbac`, `audit`. Later modules
  (billing etc.) reach 1.0 on their own evidence, not by calendar sympathy.
- **Version coupling:** none enforced between packages; the compatibility
  table is the coupling contract (`auth 1.2 requires kernel ^1.1, tenancy
^1.0`), expressed in peerDependencies and verified in CI compose tests.
- **Schema versions** (DB migrations) and **event contract versions**
  (`…member.removed.v1`) are independent tracks; a package minor may add
  event v2 while still emitting v1 per the deprecation policy below.

## 3. Semantic Versioning Plan — what "breaking" means here

The public surface (semver perimeter) is precisely: package `exports` maps
(types + runtime), HTTP endpoints marked `stable`, the error-code registry,
event contracts, migration compatibility (N/N+1), and documented config
schemas. Internals — anything not exported — carry no compatibility promise.

| Change                                                      | Pre-1.0            | Post-1.0                                                                            |
| ----------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| Add use case / endpoint / optional field / event type       | patch or minor     | **minor**                                                                           |
| Add required config with safe default                       | minor              | minor                                                                               |
| New adapter subpath                                         | minor              | minor                                                                               |
| Remove/rename any public export, endpoint, error code       | minor (with notes) | **major**                                                                           |
| Change field type/semantics, tighten validation             | minor (with notes) | **major**                                                                           |
| New required config without default                         | minor              | **major**                                                                           |
| Migration that old code cannot run against (violates N/N+1) | forbidden          | **forbidden** (split into expand+contract across majors/minors per DB §18)          |
| Raise Node/Postgres floor                                   | minor              | **major**                                                                           |
| Security fix that necessarily breaks (e.g. token format)    | patch + advisory   | patch + advisory — **the one sanctioned break**, with advisory-documented migration |

**Deprecation policy (post-1.0):** deprecate in minor N (runtime warning +
`Deprecation` header + changelog), remove no earlier than the next major;
HTTP endpoints additionally carry `Sunset` per API §18. Deprecations are
tracked in a registry (E14-T22) so nothing is removed by surprise or kept by
amnesia.

**Changeset discipline:** every PR touching a published package needs a
changeset stating the bump _and a consumer-facing sentence_; CI blocks PRs
that modify `packages/*/src` without one (`skip-changeset` label requires a
maintainer and a reason). The changelog is written at PR time by the person
with context — not reconstructed at release time by whoever drew the short
straw.
