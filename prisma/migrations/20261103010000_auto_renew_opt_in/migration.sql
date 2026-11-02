-- Tự gia hạn bằng ví chỉ chạy khi khách tự bật. Trước đây cờ luôn bật mà khách không chọn: tắt hết.
ALTER TABLE "monthly_subscriptions" ALTER COLUMN "auto_renew" SET DEFAULT false;
UPDATE "monthly_subscriptions" SET "auto_renew" = false WHERE "auto_renew" = true;
