-- Thanh toán trước khi ra bãi + mã ra cổng (dùng ví của module wallets sẵn có)
ALTER TABLE "parking_sessions" ADD COLUMN "prepaid_at" TIMESTAMPTZ(6);
ALTER TABLE "parking_sessions" ADD COLUMN "exit_pass_code" VARCHAR(12);
