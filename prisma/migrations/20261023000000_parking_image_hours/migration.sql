-- Ảnh và giờ mở cửa của bãi, hiển thị trên thẻ bãi ở app khách.
ALTER TABLE "parkings" ADD COLUMN "image_url" VARCHAR(2048),
ADD COLUMN "opening_hours" VARCHAR(50);
