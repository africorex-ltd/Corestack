-- @description: create tenancy.notification_delivery_payloads with RLS attached from creation (E05-T16)
-- @lock-impact: none

-- The durable delivery-payload table (E05-T16 Sections 3/6). Written by
-- the JSON delivery adapter
-- (packages/tenancy/src/infrastructure/postgres/
-- notification-payload-delivery-adapter.ts), which converts a
-- NotificationWorkItem into a stable, provider-agnostic
-- NotificationDeliveryPayload and stores it here without performing any
-- network I/O (Section 1/13). No HTTP route reads or writes this table
-- (Section 6: "keep it internal to the tenancy module") and no real email
-- provider is wired up yet (Section 12: "provider integration becomes a
-- thin adapter later").
--
-- `id` is the *source work item's own id*, not a freshly generated one —
-- see notification-delivery-payload.ts's module doc for why reusing it is
-- what makes buildNotificationDeliveryPayload deterministic and this
-- table's INSERT idempotent (ON CONFLICT (id) DO NOTHING below).
--
-- `organization_id` is not one of Section 3's listed payload fields (the
-- payload model's only tenant-identifying field lives inside
-- `payload.metadata.organizationId`, jsonb-encoded) — it is promoted to a
-- real, indexed, RLS-scoped column here because every durable tenancy
-- table in this module carries one (ADR-0008's tenant-isolation permanent
-- policy), and a table holding one row per tenant-scoped notification
-- with no way to enforce or query per-organization visibility would be a
-- silent regression of that policy, not a simplification Section 6
-- actually asked for. `notification_type`/`recipient`/`created_at` are
-- likewise promoted, real columns — Section 6's literal list — derived
-- from, and always written in lockstep with, the same `payload` jsonb
-- blob (see the mapper's own doc comment for why this cannot drift in
-- practice).
--
-- RLS is enabled/forced from creation, reusing the exact same
-- buildOrgScopedTableRlsDdl() generator 0002/0003 already use — see
-- test/infrastructure/migration-notification-delivery-payloads-
-- consistency.test.ts for the byte-for-byte (whitespace-normalized)
-- verification. tenancy_app's UPDATE grant is unused today (this table is
-- never updated, only inserted and read) — the same "future-proofing,
-- matches every other tenancy table's convention" tradeoff 0003 already
-- accepted for its own unused UPDATE grant.
--
-- Must run after ensureTenancyModuleRoles has created the tenancy_app/
-- tenancy_platform roles — same precondition every prior migration here
-- documents.

CREATE TABLE tenancy.notification_delivery_payloads (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  notification_type text NOT NULL,
  recipient text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT notification_delivery_payloads_type_check
    CHECK (notification_type IN ('INVITATION_CREATED', 'INVITATION_ACCEPTED', 'INVITATION_EXPIRED'))
);

ALTER TABLE tenancy.notification_delivery_payloads
  ADD CONSTRAINT notification_delivery_payloads_organization_id_organizations_id_fk
  FOREIGN KEY (organization_id) REFERENCES tenancy.organizations (id) ON DELETE CASCADE;

CREATE INDEX notification_delivery_payloads_organization_idx ON tenancy.notification_delivery_payloads
  USING btree (organization_id);
CREATE INDEX notification_delivery_payloads_type_idx ON tenancy.notification_delivery_payloads
  USING btree (notification_type);

-- ============================================================
-- Row-Level Security (E05-T16, reusing E05-T10's generator)
-- ============================================================
ALTER TABLE tenancy.notification_delivery_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.notification_delivery_payloads FORCE ROW LEVEL SECURITY;

CREATE POLICY notification_delivery_payloads_select ON tenancy.notification_delivery_payloads
  FOR SELECT
  TO tenancy_app
  USING (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY notification_delivery_payloads_insert ON tenancy.notification_delivery_payloads
  FOR INSERT
  TO tenancy_app
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY notification_delivery_payloads_update ON tenancy.notification_delivery_payloads
  FOR UPDATE
  TO tenancy_app
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY notification_delivery_payloads_platform_full_access ON tenancy.notification_delivery_payloads
  FOR ALL
  TO tenancy_platform
  USING (true);

COMMENT ON POLICY notification_delivery_payloads_platform_full_access ON tenancy.notification_delivery_payloads
  IS 'E05-T16: platform-role bypass — the JSON delivery adapter writes through this via SET LOCAL ROLE tenancy_platform, the same elevation E05-T11/T14/T15 already established.';

-- ============================================================
-- Grants (E05-T16)
-- ============================================================
--
-- tenancy_platform gets SELECT + INSERT: INSERT because it is the role
-- the real writer (notification-payload-delivery-adapter.ts) runs as,
-- SELECT so findById (used by a future provider adapter's replay path,
-- and by this task's own "durable persistence"/"replay safety" tests) can
-- read across every organization without a further grant.
GRANT SELECT, INSERT, UPDATE ON tenancy.notification_delivery_payloads TO tenancy_app;
GRANT SELECT, INSERT ON tenancy.notification_delivery_payloads TO tenancy_platform;
