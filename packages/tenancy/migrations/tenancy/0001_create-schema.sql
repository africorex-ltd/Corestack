-- @description: reserve the tenancy schema namespace; no tables yet
-- @lock-impact: none

-- Deliberately schema-only (E05-T01, Section 6 — "do not implement tables
-- yet"). The organizations/memberships/invitations tables and RLS
-- policies shipped in 0002 (E05-T10), once the aggregates that constrain
-- their shape (E05-T02-T05) existed; the app/platform roles and
-- repository adapters that consume them shipped in E05-T10/T11
-- respectively. See migrations/tenancy/README.md for the full history.
CREATE SCHEMA IF NOT EXISTS tenancy;
