-- ParkingSession ownership is derived solely through vehicle_id -> vehicles.user_id.
-- A guest session has vehicle_id NULL and therefore has no user owner.
ALTER TABLE "parking_sessions"
  DROP CONSTRAINT "parking_sessions_vehicle_driver_fkey";

DROP INDEX "idx_parking_sessions_driver_user_id";

ALTER TABLE "parking_sessions"
  DROP CONSTRAINT "parking_sessions_driver_user_id_fkey",
  DROP COLUMN "driver_user_id";
