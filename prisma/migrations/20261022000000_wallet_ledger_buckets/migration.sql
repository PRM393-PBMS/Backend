-- Ví 2 ngăn: CASH (tiền thật, giữ nguyên số dư cũ) + BONUS (khuyến mãi, bắt đầu = 0).
-- Toàn bộ giao dịch cũ thuộc ngăn CASH (mặc định cột bucket).

-- CreateEnum
CREATE TYPE "WalletBucket" AS ENUM ('CASH', 'BONUS');

-- CreateEnum
CREATE TYPE "AdjustmentReasonType" AS ENUM ('PROMOTION', 'COMPENSATION', 'CORRECTION', 'EXPIRED');

-- DropIndex
DROP INDEX "wallet_transactions_payment_id_key";

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "bonus_balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "bonus_expires_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN     "bucket" "WalletBucket" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "description" VARCHAR(255),
ADD COLUMN     "reference_id" VARCHAR(64),
ADD COLUMN     "reference_type" VARCHAR(30);

-- CreateTable
CREATE TABLE "wallet_adjustment_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wallet_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "reason_type" "AdjustmentReasonType" NOT NULL,
    "note" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_adjustment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_wallet_adjustment_logs_wallet_created" ON "wallet_adjustment_logs"("wallet_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_wallet_transactions_reference" ON "wallet_transactions"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_payment_id_bucket_key" ON "wallet_transactions"("payment_id", "bucket");

-- AddForeignKey
ALTER TABLE "wallet_adjustment_logs" ADD CONSTRAINT "wallet_adjustment_logs_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_adjustment_logs" ADD CONSTRAINT "wallet_adjustment_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Chuẩn hoá loại giao dịch cũ: TopUp -> TOP_UP, SubscriptionFee/ParkingFee -> DEBIT,
-- nghiệp vụ gốc chuyển sang reference_type/reference_id (= payment_id).
UPDATE "wallet_transactions"
SET "reference_type" = 'WalletTopUp',
    "reference_id" = "payment_id"::text,
    "type" = 'TOP_UP'
WHERE "type" = 'TopUp';

UPDATE "wallet_transactions"
SET "reference_type" = "type",
    "reference_id" = "payment_id"::text,
    "type" = 'DEBIT'
WHERE "type" IN ('SubscriptionFee', 'ParkingFee');
