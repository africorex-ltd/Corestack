-- @description: create acme_crm.contacts and acme_crm.welcome_log with tenant-isolation RLS
-- @lock-impact: none

CREATE SCHEMA IF NOT EXISTS acme_crm;

CREATE TABLE acme_crm.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contacts_organization_id_idx ON acme_crm.contacts (organization_id);

-- Side-effect log the idempotent "welcome" consumer writes to (step 6 of
-- the contributor guide) — lets the integration test prove idempotency
-- concretely (exactly one row survives redelivery), the same way T14's
-- own tests prove ProcessedEventStore's dedupe guarantee.
CREATE TABLE acme_crm.welcome_log (
  contact_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  welcomed_at timestamptz NOT NULL DEFAULT now()
);

-- The RLS statements below are exactly what buildTenantIsolationDdl()
-- generates for each table (schema: "acme_crm", appRole: "acme_crm_app",
-- platformRole: "acme_crm_platform") — written out here as plain SQL
-- because this migration runs through platform's real migration engine
-- (T01/T02), not as a one-off bootstrap script. See
-- src/infrastructure/ensure-acme-crm-roles.ts for the role-creation step
-- that must run before this migration applies (a policy can't reference a
-- role that doesn't exist yet).
ALTER TABLE acme_crm.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE acme_crm.contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON acme_crm.contacts
  TO acme_crm_app
  USING (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY platform_full_access ON acme_crm.contacts
  TO acme_crm_platform
  USING (true);

ALTER TABLE acme_crm.welcome_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE acme_crm.welcome_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON acme_crm.welcome_log
  TO acme_crm_app
  USING (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY platform_full_access ON acme_crm.welcome_log
  TO acme_crm_platform
  USING (true);

-- The app role needs DELETE on contacts too: the purge handler
-- (organization deletion, ADR-0008's tenant-lifecycle protocol) deletes a
-- purged org's own rows by running as the app role with app.current_org
-- set to the org being purged — the same RLS scoping as any other write,
-- not an escalated role. The platform role only needs SELECT here, to
-- demonstrate its cross-tenant visibility (matching T30's own tests).
GRANT USAGE ON SCHEMA acme_crm TO acme_crm_app, acme_crm_platform;
GRANT SELECT, INSERT, DELETE ON acme_crm.contacts TO acme_crm_app;
GRANT SELECT ON acme_crm.contacts TO acme_crm_platform;
GRANT SELECT, INSERT, DELETE ON acme_crm.welcome_log TO acme_crm_app;
GRANT SELECT ON acme_crm.welcome_log TO acme_crm_platform;
