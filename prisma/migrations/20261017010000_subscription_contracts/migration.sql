-- Hợp đồng vé tháng 3/6/9/12 tháng + chữ ký điện tử và niêm phong số
CREATE TABLE "subscription_contracts" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "contract_number" VARCHAR(30) NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PendingSignature',
    "signer_name" VARCHAR(100),
    "signature_image" TEXT,
    "signature_image_hash" VARCHAR(64),
    "signed_at" TIMESTAMPTZ(6),
    "signer_ip" VARCHAR(45),
    "seal" TEXT,
    "seal_key_id" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscription_contracts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "subscription_contracts_subscription_id_key" ON "subscription_contracts"("subscription_id");
CREATE UNIQUE INDEX "subscription_contracts_contract_number_key" ON "subscription_contracts"("contract_number");
CREATE INDEX "idx_subscription_contracts_user_id" ON "subscription_contracts"("user_id");
ALTER TABLE "subscription_contracts" ADD CONSTRAINT "subscription_contracts_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "monthly_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
