-- Create parkings, backfill existing slots onto a default lot, then require parking_id.
-- Slot codes stay unique per parking instead of globally.

CREATE TABLE "parkings" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "location" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parkings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parkings_name_key" ON "parkings"("name");

INSERT INTO "parkings" ("id", "name", "location", "created_at", "updated_at")
VALUES (
    gen_random_uuid(),
    'Default Parking',
    'N/A',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

ALTER TABLE "parking_slots" ADD COLUMN "parking_id" UUID;

UPDATE "parking_slots"
SET "parking_id" = (
    SELECT "id" FROM "parkings" WHERE "name" = 'Default Parking' LIMIT 1
)
WHERE "parking_id" IS NULL;

ALTER TABLE "parking_slots" ALTER COLUMN "parking_id" SET NOT NULL;

ALTER TABLE "parking_slots"
ADD CONSTRAINT "parking_slots_parking_id_fkey"
FOREIGN KEY ("parking_id") REFERENCES "parkings"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "parking_slots_slot_code_key";

CREATE UNIQUE INDEX "parking_slots_parking_id_slot_code_key"
ON "parking_slots"("parking_id", "slot_code");

CREATE INDEX "idx_parking_slots_parking_id" ON "parking_slots"("parking_id");
