-- @description: create tenancy.organizations/memberships/invitations with RLS attached from creation
-- @lock-impact: none

-- CREATE TABLE statements below were generated via `drizzle-kit generate`
-- against the frozen Drizzle schema (E05-T09,
-- packages/tenancy/src/infrastructure/postgres/schema/) and hand-verified
-- against it column-for-column, constraint-for-constraint — closing the
-- "RLS DDL is hand-transcribed today" gap this directory's own README
-- flagged since E05-T01. drizzle-kit was used as a one-time generation
-- aid (not added as a persistent dependency of this package); the
-- question of a permanent, on-every-schema-change generation pipeline
-- remains open, same conclusion the README already reached.
--
-- Tables are created with RLS enabled/forced in this same migration —
-- never a moment where any of these tables exists without RLS already
-- attached (Section 11's "FORCE RLS by default" permanent policy).
--
-- Must run after `ensureTenancyModuleRoles` (packages/tenancy/src/
-- infrastructure/postgres/ensure-tenancy-postgres-roles.ts) has created
-- the `tenancy_app`/`tenancy_platform` roles — a `CREATE POLICY ... TO
-- tenancy_app` statement can't reference a role that doesn't exist yet,
-- the same precondition `examples/acme-crm-module`'s own migration
-- documents for its roles.

CREATE TABLE tenancy.organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT organizations_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED'))
);

CREATE UNIQUE INDEX organizations_slug_key ON tenancy.organizations USING btree (slug);
CREATE INDEX organizations_status_idx ON tenancy.organizations USING btree (status);

CREATE TABLE tenancy.memberships (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  joined_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  removed_at timestamptz,
  CONSTRAINT memberships_role_check CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  CONSTRAINT memberships_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REMOVED'))
);

ALTER TABLE tenancy.memberships
  ADD CONSTRAINT memberships_organization_id_organizations_id_fk
  FOREIGN KEY (organization_id) REFERENCES tenancy.organizations (id) ON DELETE CASCADE;

-- Partial unique index — the active-membership rule (E05-T09 Section 5):
-- at most one ACTIVE membership per (organization, user). See
-- docs/modules/tenancy-schema-design.md's "membership uniqueness
-- strategy" for the full rationale, including why SUSPENDED is
-- deliberately excluded from this index's scope.
CREATE UNIQUE INDEX memberships_active_org_user_key ON tenancy.memberships
  USING btree (organization_id, user_id) WHERE status IN ('ACTIVE');
CREATE INDEX memberships_org_user_idx ON tenancy.memberships USING btree (organization_id, user_id);

CREATE TABLE tenancy.invitations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  CONSTRAINT invitations_role_check CHECK (role IN ('ADMIN', 'MEMBER')),
  CONSTRAINT invitations_status_check CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'))
);

ALTER TABLE tenancy.invitations
  ADD CONSTRAINT invitations_organization_id_organizations_id_fk
  FOREIGN KEY (organization_id) REFERENCES tenancy.organizations (id) ON DELETE CASCADE;

-- Partial unique index — one PENDING invitation per (organization,
-- email); history rows (ACCEPTED/REVOKED/EXPIRED) remain and are
-- deliberately excluded from the uniqueness scope.
CREATE UNIQUE INDEX invitations_pending_org_email_key ON tenancy.invitations
  USING btree (organization_id, email) WHERE status IN ('PENDING');
CREATE INDEX invitations_organization_idx ON tenancy.invitations USING btree (organization_id);

-- ============================================================
-- Row-Level Security (E05-T10)
-- ============================================================
--
-- The statements below are exactly what
-- packages/tenancy/src/infrastructure/postgres/rls/organizations-policies.ts
-- and org-scoped-table-policies.ts generate for
-- (schema: "tenancy", appRole: "tenancy_app", platformRole:
-- "tenancy_platform") — written out here as plain SQL because this
-- migration runs through platform's real migration engine, not as a
-- one-off bootstrap script (same convention as
-- examples/acme-crm-module's own migration).
--
-- Session variable: current_setting('app.current_org') — the platform's
-- one existing tenant-context mechanism (ADR-0008 layer 3), deliberately
-- without the `missing_ok` argument: an unset session throws
-- "unrecognized configuration parameter" (fail closed, loud), not a
-- silent empty result. See docs/modules/tenancy-rls-design.md's
-- "Fail-closed behaviour" section, including why this migration does
-- NOT use the literal `app.current_organization_id` name the E05-T10
--
-- Every predicate below (and every CHECK constraint above) references
-- its column bare (`id`, `organization_id`, `status`, ...), never
-- schema/table-qualified. A three-part dotted name like
-- `tenancy.organizations.id` is not a valid table-qualified column
-- reference in Postgres here — it parses as `database.schema.object`
-- and is rejected. RLS policy expressions are also evaluated against
-- whatever alias (if any) the calling query gives the table, so a
-- hard-coded table-qualified name would break under aliasing even where
-- it happened to parse.
-- founder directive's Section 3 mentions.
--
-- organizations: direct (id-keyed) visibility — ADR-0024. SELECT,
-- INSERT, and UPDATE all use the identical predicate
-- (id = current_setting('app.current_org')::uuid); organization
-- creation is not special-cased (see the ADR and
-- organizations-policies.ts's own doc comment for why).
ALTER TABLE tenancy.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.organizations FORCE ROW LEVEL SECURITY;

CREATE POLICY organizations_select ON tenancy.organizations
  FOR SELECT
  TO tenancy_app
  USING (id = current_setting('app.current_org')::uuid);

CREATE POLICY organizations_insert ON tenancy.organizations
  FOR INSERT
  TO tenancy_app
  WITH CHECK (id = current_setting('app.current_org')::uuid);

CREATE POLICY organizations_update ON tenancy.organizations
  FOR UPDATE
  TO tenancy_app
  USING (id = current_setting('app.current_org')::uuid)
  WITH CHECK (id = current_setting('app.current_org')::uuid);

CREATE POLICY organizations_platform_full_access ON tenancy.organizations
  FOR ALL
  TO tenancy_platform
  USING (true);

COMMENT ON POLICY organizations_select ON tenancy.organizations
  IS 'E05-T10 / ADR-0024: direct visibility — reads only the organization matching app.current_org.';
COMMENT ON POLICY organizations_platform_full_access ON tenancy.organizations
  IS 'E05-T10: platform-role bypass for future cross-organization administration (Section 4).';

-- memberships / invitations: standard org-scoped visibility —
-- organization_id = current_setting('app.current_org')::uuid. DELETE is
-- intentionally never granted or policied for tenancy_app on either
-- table: no Membership/Invitation aggregate method ever performs a
-- physical DELETE (Membership.remove()/every Invitation terminal
-- transition are soft-deletes via a status UPDATE). See
-- docs/modules/tenancy-rls-design.md's policy matrix.
ALTER TABLE tenancy.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY memberships_select ON tenancy.memberships
  FOR SELECT
  TO tenancy_app
  USING (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY memberships_insert ON tenancy.memberships
  FOR INSERT
  TO tenancy_app
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY memberships_update ON tenancy.memberships
  FOR UPDATE
  TO tenancy_app
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY memberships_platform_full_access ON tenancy.memberships
  FOR ALL
  TO tenancy_platform
  USING (true);

COMMENT ON POLICY memberships_platform_full_access ON tenancy.memberships
  IS 'E05-T10: platform-role bypass (relay/sweepers/support tooling), matching every other tenancy table.';

ALTER TABLE tenancy.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY invitations_select ON tenancy.invitations
  FOR SELECT
  TO tenancy_app
  USING (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY invitations_insert ON tenancy.invitations
  FOR INSERT
  TO tenancy_app
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY invitations_update ON tenancy.invitations
  FOR UPDATE
  TO tenancy_app
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY invitations_platform_full_access ON tenancy.invitations
  FOR ALL
  TO tenancy_platform
  USING (true);

COMMENT ON POLICY invitations_platform_full_access ON tenancy.invitations
  IS 'E05-T10: platform-role bypass (relay/sweepers/support tooling), matching every other tenancy table.';

-- ============================================================
-- Grants (E05-T10)
-- ============================================================
--
-- RLS policies only ever *restrict* rows an already-permitted operation
-- can see/touch — the underlying privilege still has to exist via GRANT,
-- or the operation is rejected before RLS is ever evaluated. DELETE is
-- deliberately not granted to tenancy_app on any table (see above); the
-- platform role is deliberately granted SELECT only today, matching
-- examples/acme-crm-module's own precedent ("the platform role only
-- needs SELECT here, to demonstrate its cross-tenant visibility") — no
-- write/delete use case exists yet for platform-scoped tenancy access.
GRANT USAGE ON SCHEMA tenancy TO tenancy_app, tenancy_platform;

GRANT SELECT, INSERT, UPDATE ON tenancy.organizations TO tenancy_app;
GRANT SELECT ON tenancy.organizations TO tenancy_platform;

GRANT SELECT, INSERT, UPDATE ON tenancy.memberships TO tenancy_app;
GRANT SELECT ON tenancy.memberships TO tenancy_platform;

GRANT SELECT, INSERT, UPDATE ON tenancy.invitations TO tenancy_app;
GRANT SELECT ON tenancy.invitations TO tenancy_platform;
