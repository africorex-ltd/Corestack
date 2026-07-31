-- @description: create tenancy.notification_work_items with RLS attached from creation (E05-T14)
-- @lock-impact: none

-- The durable notification work-item table (E05-T14 Section 4/6). Written
-- by the invitation-notification event consumer
-- (packages/tenancy/src/infrastructure/postgres/
-- invitation-notification-consumer.ts) only — no HTTP route reads or
-- writes this table (Section 6: "keep it internal to the tenancy module
-- for now"). No delivery worker exists yet that transitions
-- PENDING -> PROCESSING -> PROCESSED/FAILED (Section 7: "do not implement
-- a scheduler"); this migration only needs to make those four values
-- legal, not reachable.
--
-- RLS is enabled/forced from creation, same as every other tenancy table
-- (Section 11's "FORCE RLS by default" permanent policy, first
-- established in 0002). The statements below are exactly what
-- packages/tenancy/src/infrastructure/postgres/rls/
-- org-scoped-table-policies.ts's buildOrgScopedTableRlsDdl() generates for
-- (schema: "tenancy", table: "notification_work_items", appRole:
-- "tenancy_app", platformRole: "tenancy_platform") — the same generator
-- 0002 already reuses for memberships/invitations, hand-verified here the
-- same way (see test/infrastructure/migration-notification-work-items-
-- consistency.test.ts).
--
-- Must run after ensureTenancyModuleRoles (packages/tenancy/src/
-- infrastructure/postgres/ensure-tenancy-postgres-roles.ts) has created
-- the tenancy_app/tenancy_platform roles — same precondition 0002
-- documents.
--
-- attempts has no column DEFAULT: the only writer
-- (PostgresNotificationWorkItemRepository.create) always supplies it
-- explicitly from the NotificationWorkItem model (0 for a freshly built
-- item), so a DEFAULT would never fire — same "no fallback for a case
-- that can't happen" discipline as this task's recipient-nullability
-- choice, not an oversight.

CREATE TABLE tenancy.notification_work_items (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  organization_id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  recipient text,
  payload jsonb NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL,
  created_at timestamptz NOT NULL,
  processed_at timestamptz,
  last_error text,
  CONSTRAINT notification_work_items_type_check
    CHECK (type IN ('INVITATION_CREATED', 'INVITATION_ACCEPTED', 'INVITATION_EXPIRED')),
  CONSTRAINT notification_work_items_status_check
    CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'))
);

ALTER TABLE tenancy.notification_work_items
  ADD CONSTRAINT notification_work_items_organization_id_organizations_id_fk
  FOREIGN KEY (organization_id) REFERENCES tenancy.organizations (id) ON DELETE CASCADE;

CREATE INDEX notification_work_items_organization_idx ON tenancy.notification_work_items
  USING btree (organization_id);
CREATE INDEX notification_work_items_status_idx ON tenancy.notification_work_items
  USING btree (status);

-- ============================================================
-- Row-Level Security (E05-T14, reusing E05-T10's generator)
-- ============================================================
--
-- Standard org-scoped visibility for tenancy_app — organization_id =
-- current_setting('app.current_org')::uuid — even though no code calls
-- this table as tenancy_app yet (no HTTP route exists this task); adding
-- the standard policy set now, matching every other tenancy table
-- unconditionally, means a future "list my org's notification history"
-- read needs no RLS migration of its own. tenancy_platform's
-- FOR ALL ... USING (true) bypass is what the real writer
-- (invitation-notification-consumer.ts) actually uses today, via
-- SET LOCAL ROLE tenancy_platform (E05-T11's existing elevation grant) —
-- the same "relay/sweepers/support tooling" case
-- memberships_platform_full_access/invitations_platform_full_access
-- already anticipated in 0002's own policy comments.
ALTER TABLE tenancy.notification_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.notification_work_items FORCE ROW LEVEL SECURITY;

CREATE POLICY notification_work_items_select ON tenancy.notification_work_items
  FOR SELECT
  TO tenancy_app
  USING (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY notification_work_items_insert ON tenancy.notification_work_items
  FOR INSERT
  TO tenancy_app
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY notification_work_items_update ON tenancy.notification_work_items
  FOR UPDATE
  TO tenancy_app
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

CREATE POLICY notification_work_items_platform_full_access ON tenancy.notification_work_items
  FOR ALL
  TO tenancy_platform
  USING (true);

COMMENT ON POLICY notification_work_items_platform_full_access ON tenancy.notification_work_items
  IS 'E05-T14: platform-role bypass — the invitation-notification consumer writes through this via SET LOCAL ROLE tenancy_platform, the same elevation E05-T11 established for existsBySlug/findBySlug.';

-- ============================================================
-- Grants (E05-T14)
-- ============================================================
--
-- tenancy_app gets the standard SELECT/INSERT/UPDATE set (unused today,
-- future-proofing per the RLS comment above) but never DELETE, matching
-- every other tenancy table's convention exactly. tenancy_platform gets
-- SELECT + INSERT — INSERT because it's the role the real writer actually
-- runs as; SELECT so a future delivery worker (not built this task) can
-- read PENDING rows across every organization without a further grant.
GRANT SELECT, INSERT, UPDATE ON tenancy.notification_work_items TO tenancy_app;
GRANT SELECT, INSERT ON tenancy.notification_work_items TO tenancy_platform;
