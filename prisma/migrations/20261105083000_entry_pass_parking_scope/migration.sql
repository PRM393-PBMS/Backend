-- Legacy passes remain unscoped and must be recreated by their owners.
-- No historical parking is inferred and no pass/session is deleted.
ALTER TABLE "entry_passes" ADD COLUMN "parking_id" UUID;
CREATE INDEX "idx_entry_passes_parking_id" ON "entry_passes"("parking_id");
ALTER TABLE "entry_passes" ADD CONSTRAINT "entry_passes_parking_id_fkey"
  FOREIGN KEY ("parking_id") REFERENCES "parkings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
