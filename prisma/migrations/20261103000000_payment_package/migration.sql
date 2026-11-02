-- Gói khách chọn khi gia hạn vé tháng qua PayOS.
ALTER TABLE "payments" ADD COLUMN "package_id" UUID;
