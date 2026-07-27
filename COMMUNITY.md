# CoreStack Community

Where to find people, get help, and grow from user to maintainer.

## Channels — what goes where

| Channel                              | For                                        | Response expectation                               |
| ------------------------------------ | ------------------------------------------ | -------------------------------------------------- |
| **GitHub Discussions → Support**     | usage questions ("how do I…")              | community + triage rotation; best-effort           |
| **GitHub Discussions → RFC**         | design proposals before code               | maintainer engagement within FCP rules             |
| **GitHub Discussions → Show & Tell** | things you built on CoreStack              | 🎉                                                 |
| **GitHub Issues**                    | confirmed bugs (with repro) + planned work | first response ≤ 3 working days                    |
| **Security (private advisories)**    | vulnerabilities — never public issues      | acknowledgment ≤ 72 h ([SECURITY.md](SECURITY.md)) |
| **Community chat**                   | real-time chat (link in README once live)  | informal; decisions still happen on GitHub         |

**Decisions live on GitHub.** Chat is for velocity; anything that matters gets
written down where it's searchable — a community norm, stated up front.

## The contribution ladder

**User → issue reporter → adapter author → module contributor → module
maintainer → core maintainer.** Each rung has objective criteria in
[GOVERNANCE.md](GOVERNANCE.md); the practical path:

1. Use CoreStack; file good bug reports (a great repro is a real contribution).
2. Pick a [`flag:good-first-issue`](docs/engineering/08-github-project.md) —
   each has a named mentor.
3. Build an **adapter** against a port's contract suite — the designed entry
   point for substantial contribution
   ([guide](docs/guides/PLUGIN_DEVELOPMENT.md)); certified adapters are listed
   in official docs.
4. Sustained module contributions → nomination per GOVERNANCE.md.

## Recognition

Contributors are credited in release notes; community adapters/modules are
listed in the docs registry with author attribution; maintainer emeritus
status is permanent and public.

## Cadence

- **Monthly devlog** — written changelog/devlog covering progress, decisions,
  and roadmap changes (the vision's reach channel). Roadmap date revisions
  happen here first.
- **Release trains** — every two weeks when there's cargo
  ([release policy](docs/engineering/09-release-versioning.md)).
- **Triage rotation** — weekdays; SLAs above.

## Conduct

Everything here operates under the [Code of Conduct](CODE_OF_CONDUCT.md).
Assume good faith; write for the archive; kindness scales.
