# Changesets

Every PR that changes a published package's behavior adds a changeset
(`pnpm changeset`). Pre-1.0 semantics: **minor may break, patch never does**
— see [docs/engineering/09-release-versioning.md](../docs/engineering/09-release-versioning.md).

Write the changeset as a consumer-facing sentence: what changed and what, if
anything, the adopter must do. The changelog is written now, by you, with
context — not reconstructed at release time.
