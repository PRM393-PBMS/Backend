BEGIN;
ALTER TABLE payments ADD COLUMN renewal_package_id uuid REFERENCES subscription_packages(id) ON DELETE RESTRICT ON UPDATE CASCADE, ADD COLUMN renewal_duration_days integer;
CREATE INDEX payments_renewal_package_idx ON payments(renewal_package_id);
ALTER TABLE payments ADD COLUMN applied_at timestamptz(6), ADD COLUMN reconciliation_reason varchar(120);
-- Historical success is deliberately not replayed without a human audit.
UPDATE payments SET reconciliation_reason = 'LEGACY_REVIEW_REQUIRED' WHERE payment_status = 'Success';
CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  operation varchar(255) NOT NULL,
  key varchar(128) NOT NULL,
  payload_hash varchar(64) NOT NULL,
  response jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idempotency_records_user_id_operation_key_key ON idempotency_records(user_id, operation, key);
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON idempotency_records FROM PUBLIC;
COMMIT;
