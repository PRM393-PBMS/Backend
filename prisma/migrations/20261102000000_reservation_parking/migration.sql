-- Đặt chỗ gắn theo bãi: hạn mức, khung giờ và check-in tính theo bãi khách chọn.
-- Đơn cũ để trống (null): vẫn check-in được ở mọi bãi như trước.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "parking_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_parking_id_fkey') THEN
    ALTER TABLE "reservations"
      ADD CONSTRAINT "reservations_parking_id_fkey"
      FOREIGN KEY ("parking_id") REFERENCES "parkings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_reservations_parking_time" ON "reservations"("parking_id", "expected_entry_time");
