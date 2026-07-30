-- @description: reserve the tenancy schema namespace; no tables yet
-- @lock-impact: none

-- Deliberately schema-only (E05-T01, Section 6 — "do not implement tables
-- yet"). The organizations/memberships/invitations tables, their RLS
-- policies, and the app/platform roles they reference all ship together in
-- E05-T21 once the aggregates that constrain their shape (E05-T02–T04)
-- exist. See migrations/tenancy/README.md for the RLS-DDL bridge gap this
-- next migration will have to resolve.
CREATE SCHEMA IF NOT EXISTS tenancy;
