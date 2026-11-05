-- Run scripts/exception-preflight.mjs against the intended development database first.
-- Index creation fails rather than deleting/guessing conflicting historical data.
BEGIN;
CREATE UNIQUE INDEX parking_sessions_open_plate_key ON parking_sessions(license_plate_in) WHERE status IN ('Active','Exception');
CREATE UNIQUE INDEX parking_sessions_open_slot_key ON parking_sessions(actual_slot_id) WHERE status IN ('Active','Exception') AND actual_slot_id IS NOT NULL;
CREATE UNIQUE INDEX entry_passes_active_vehicle_key ON entry_passes(vehicle_id) WHERE status = 'Active';
CREATE UNIQUE INDEX monthly_subscriptions_open_vehicle_key ON monthly_subscriptions(vehicle_id) WHERE status IN ('PendingPayment','Active');
CREATE UNIQUE INDEX payments_payos_order_key ON payments(transaction_reference) WHERE payment_method = 'PayOS' AND transaction_reference IS NOT NULL AND transaction_reference <> '';
CREATE INDEX payments_unapplied_idx ON payments(payment_time) WHERE payment_status = 'Success' AND applied_at IS NULL;
COMMIT;
