-- A registered vehicle belongs to exactly one user and one vehicle type.
-- License plates/type columns kept on existing operational tables are immutable
-- snapshots, so historical fees and guest sessions remain readable.
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "vehicle_type_id" UUID NOT NULL,
    "license_plate" VARCHAR(15) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicles_license_plate_key" ON "vehicles"("license_plate");
CREATE INDEX "idx_vehicles_user_id" ON "vehicles"("user_id");
CREATE INDEX "idx_vehicles_vehicle_type_id" ON "vehicles"("vehicle_type_id");

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_vehicle_type_id_fkey"
  FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "monthly_subscriptions" ADD COLUMN "vehicle_id" UUID;
ALTER TABLE "reservations" ADD COLUMN "vehicle_id" UUID;
ALTER TABLE "parking_sessions" ADD COLUMN "vehicle_id" UUID;

-- Subscriptions include both an owner and a plate/type, so they can be migrated
-- without guessing. A duplicated legacy plate is retained for review instead of
-- assigning it to the wrong owner.
INSERT INTO "vehicles" ("id", "user_id", "vehicle_type_id", "license_plate", "created_at", "updated_at")
SELECT gen_random_uuid(), s."user_id", s."vehicle_type_id", s."license_plate", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON ("license_plate") "user_id", "vehicle_type_id", "license_plate"
  FROM "monthly_subscriptions"
  ORDER BY "license_plate", "start_date" DESC, "id" DESC
) AS s
ON CONFLICT ("license_plate") DO NOTHING;

UPDATE "monthly_subscriptions" AS s
SET "vehicle_id" = v."id"
FROM "vehicles" AS v
WHERE s."user_id" = v."user_id"
  AND s."vehicle_type_id" = v."vehicle_type_id"
  AND s."license_plate" = v."license_plate";

-- Reservations from the old model do not carry a plate. Link them only when the
-- owner has exactly one registered vehicle of the requested type; otherwise
-- leave vehicle_id NULL rather than silently selecting the wrong car.
UPDATE "reservations" AS r
SET "vehicle_id" = (
  SELECT v."id"
  FROM "vehicles" AS v
  WHERE v."user_id" = r."user_id"
    AND v."vehicle_type_id" = r."vehicle_type_id"
  LIMIT 1
)
WHERE r."vehicle_id" IS NULL
  AND 1 = (
    SELECT COUNT(*)
    FROM "vehicles" AS matching
    WHERE matching."user_id" = r."user_id"
      AND matching."vehicle_type_id" = r."vehicle_type_id"
  );

-- A reservation is the most reliable source for its resulting parking session.
UPDATE "parking_sessions" AS ps
SET "vehicle_id" = r."vehicle_id"
FROM "reservations" AS r
WHERE ps."reservation_id" = r."id"
  AND r."vehicle_id" IS NOT NULL
  AND ps."vehicle_id" IS NULL;

-- Resident/manual sessions can be linked when the registered owner, plate and
-- type all agree. Guest sessions intentionally remain NULL.
UPDATE "parking_sessions" AS ps
SET "vehicle_id" = v."id"
FROM "vehicles" AS v
WHERE ps."vehicle_id" IS NULL
  AND ps."driver_user_id" = v."user_id"
  AND ps."vehicle_type_id" = v."vehicle_type_id"
  AND ps."license_plate_in" = v."license_plate";

ALTER TABLE "monthly_subscriptions"
  ADD CONSTRAINT "monthly_subscriptions_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parking_sessions"
  ADD CONSTRAINT "parking_sessions_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_monthly_subscriptions_vehicle_id" ON "monthly_subscriptions"("vehicle_id");
CREATE INDEX "idx_reservations_vehicle_id" ON "reservations"("vehicle_id");
CREATE INDEX "idx_parking_sessions_vehicle_id" ON "parking_sessions"("vehicle_id");
