-- Finish replacing the legacy (vehicle_type_id, license_plate) snapshots on
-- subscriptions and reservations with the registered vehicle foreign key.
-- The preceding migration backfills vehicle_id conservatively. Do not discard
-- legacy values unless every row is linked to a registered vehicle.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "monthly_subscriptions"
    WHERE "vehicle_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot finalize monthly_subscriptions.vehicle_id: rows without a matching registered vehicle remain';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "reservations"
    WHERE "vehicle_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot finalize reservations.vehicle_id: rows without an unambiguous registered vehicle remain';
  END IF;
END $$;

ALTER TABLE "monthly_subscriptions"
  ALTER COLUMN "vehicle_id" SET NOT NULL,
  DROP COLUMN "vehicle_type_id",
  DROP COLUMN "license_plate";

ALTER TABLE "reservations"
  ALTER COLUMN "vehicle_id" SET NOT NULL,
  DROP COLUMN "vehicle_type_id";
