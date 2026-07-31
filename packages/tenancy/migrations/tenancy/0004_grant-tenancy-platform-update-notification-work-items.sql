-- @description: grant UPDATE on tenancy.notification_work_items to tenancy_platform (E05-T15)
-- @lock-impact: none

-- 0003 granted tenancy_platform only SELECT + INSERT on this table,
-- sized for E05-T14's one writer (the invitation-notification consumer,
-- which only ever INSERTs). E05-T15's processing service adds three
-- operations that all run as tenancy_platform (the same elevated role,
-- for the same reason: no per-call OrgScopedContext/app.current_org —
-- see ADR-0026) and all three UPDATE the table: claimNextPending
-- (PENDING -> PROCESSING), markProcessed (-> PROCESSED), and markFailed
-- (-> PENDING or FAILED). Running the real-Postgres integration suite
-- for E05-T15 surfaced the missing grant immediately: "permission denied
-- for table notification_work_items" from claimNextPending's own UPDATE
-- statement — the same class of caught-by-the-integration-suite gap
-- E05-T14 hit for platform.processed_events, just this time a genuinely
-- missing GRANT rather than a role-elevation ordering mistake.
--
-- A separate migration, not an edit to 0003: migrations are immutable
-- once shipped (0003 already ran in every environment that applied
-- E05-T14's release) — the fix is an additive GRANT, not a rewrite of
-- history.

GRANT UPDATE ON tenancy.notification_work_items TO tenancy_platform;
