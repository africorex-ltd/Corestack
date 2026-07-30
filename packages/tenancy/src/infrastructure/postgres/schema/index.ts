/**
 * `tenancy` Postgres schema definitions (E05-T09). Internal to this
 * package for now — no `./postgres` subpath export exists yet in
 * `package.json` (that ships with the first real repository adapter;
 * introducing the export condition before there is a consumer would be
 * exactly the "unused flexibility" ADR-0017 already warned against).
 * Schema-only: no repository methods, no SQL migrations, no RLS policies
 * (Section 16/2 of the E05-T09 directive) — see
 * `docs/modules/tenancy-schema-design.md`.
 */
export { tenancySchema } from "./tenancy-pg-schema.js";
export { organizations } from "./organizations.js";
export { memberships } from "./memberships.js";
export { invitations } from "./invitations.js";
