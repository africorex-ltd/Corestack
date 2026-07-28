# Lessons — E01/E02 (Foundation & Kernel), written 2026-07-28

Retro-written at the maturity-mode transition, informed by the staff audit.

## Good decisions

- **Design-first with written refusals.** The out-of-scope lists and reasoned
  "no"s (GraphQL, plugins, UI) already deflected a whole conflicting scaffold
  prompt cheaply — the reconciliation took one conversation, not a rewrite.
- **Fixture-testing the lint rules.** Boundary rules that are themselves
  tested survived two refactors without decay.
- **Auditing before building on the kernel.** The fresh-eyes pass cost half a
  day and caught two reference-semantics bugs _before_ E04 would have
  fossilized them into contract suites. Cheapest possible time to find them.

## Mistakes

- **Scaffolding CI lanes ahead of their content** created a green no-op
  required check (AUD-01). Lesson: a lane ships _with_ its truth guard or not
  at all.
- **Going live with tag-pinned actions** because SHA-pinning was scheduled
  "later" — the schedule didn't move when go-live moved (AUD-04). Lesson:
  security tasks are tied to _events_ (first push), not sequence positions.
- **Borrowing shapes across consistency models:** `markIfNew` was correct for
  in-transaction claims and silently wrong without the transaction (AUD-02).
  Lesson: reference implementations need adversarial failure-path tests from
  birth, not just happy-path semantics.

## Surprises

- pnpm 10 blocks build scripts by default (esbuild allowlist needed);
  corepack EPERMs on Windows without admin.
- TypeScript erases private-constructor param types in `.d.ts` — the
  suspected ambient-type leak didn't exist (audit AUD-N1).
- Prettier's markdown table realignment makes doc edits churn-heavy —
  format _before_ committing docs, and never hand-align tables.
- The single-version checker's first real catch was itself (peerDependency
  ranges are legitimately loose) — guards need semantic review too.

## Future improvements

- Write the regression test _first_ when fixing reference semantics (done
  for AUD-02/03; keep the habit).
- Keep the integration-manifest discipline: every new lane gets an explicit,
  versioned expectation on day one.
- Environment preflight (Docker, credentials) belongs in epic _entry_
  reviews — E03's entry review now does this; E01 didn't, and the npm/Docker
  blockers surfaced later than they should have.
