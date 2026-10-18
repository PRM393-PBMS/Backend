-- Each floor belongs to one parking area. Existing floors are assigned from
-- their parking slots; floors without slots use the oldest existing parking.
ALTER TABLE "floors" ADD COLUMN "parking_id" UUID;

UPDATE "floors" AS "f"
SET "parking_id" = COALESCE(
  (
    SELECT "ps"."parking_id"
    FROM "parking_slots" AS "ps"
    WHERE "ps"."floor_id" = "f"."id"
    ORDER BY "ps"."id"
    LIMIT 1
  ),
  (
    SELECT "p"."id"
    FROM "parkings" AS "p"
    ORDER BY "p"."created_at", "p"."id"
    LIMIT 1
  )
)
WHERE "parking_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "floors" WHERE "parking_id" IS NULL) THEN
    RAISE EXCEPTION 'Cannot assign parking_id to floors because no parking exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "parking_slots" AS "ps"
    INNER JOIN "floors" AS "f" ON "f"."id" = "ps"."floor_id"
    WHERE "ps"."parking_id" <> "f"."parking_id"
  ) THEN
    RAISE EXCEPTION 'Cannot assign one parking_id to floors with slots from multiple parkings';
  END IF;
END $$;

ALTER TABLE "floors" ALTER COLUMN "parking_id" SET NOT NULL;

ALTER TABLE "floors"
ADD CONSTRAINT "floors_parking_id_fkey"
FOREIGN KEY ("parking_id") REFERENCES "parkings"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_floors_parking_id" ON "floors"("parking_id");
