-- Toạ độ bãi đỗ cho bản đồ của app khách hàng
ALTER TABLE "parkings" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "parkings" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "parkings" ADD CONSTRAINT "parkings_latitude_range" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90);
ALTER TABLE "parkings" ADD CONSTRAINT "parkings_longitude_range" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);
