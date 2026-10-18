-- Enforce that an operational record cannot reference a vehicle owned by a
-- different user. The existing single-column vehicle FKs remain in place so a
-- nullable driver_user_id never weakens vehicle existence validation.
CREATE UNIQUE INDEX "vehicles_id_user_id_key" ON "vehicles"("id", "user_id");

ALTER TABLE "monthly_subscriptions"
  ADD CONSTRAINT "monthly_subscriptions_vehicle_owner_fkey"
  FOREIGN KEY ("vehicle_id", "user_id")
  REFERENCES "vehicles"("id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_vehicle_owner_fkey"
  FOREIGN KEY ("vehicle_id", "user_id")
  REFERENCES "vehicles"("id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "parking_sessions"
  ADD CONSTRAINT "parking_sessions_vehicle_driver_fkey"
  FOREIGN KEY ("vehicle_id", "driver_user_id")
  REFERENCES "vehicles"("id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
