# Engineering Decision Log

Day-to-day engineering decisions too small for an ADR but worth remembering
(maturity policy §11.1). One file per decision, numbered, immutable —
`NNNN-slug.md` with: context (2–3 sentences), decision, alternatives briefly,
consequences. If a decision here starts constraining architecture, promote it
to an ADR and link both ways.

| #                                | Decision                                                    |
| -------------------------------- | ----------------------------------------------------------- |
| [0001](0001-platform-package.md) | Create `@corestack/platform` rather than growing the kernel |
