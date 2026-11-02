-- Mã khuyến mãi nạp ví và yêu cầu xuất hoá đơn GTGT.
ALTER TABLE "payments" ADD COLUMN "promo_code_id" UUID;

CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "description" VARCHAR(255),
    "min_top_up" DECIMAL(15,2) NOT NULL,
    "bonus_amount" DECIMAL(15,2) NOT NULL,
    "bonus_valid_days" INTEGER NOT NULL DEFAULT 30,
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

CREATE TABLE "promo_redemptions" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "bonus_amount" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "promo_redemptions_payment_id_key" ON "promo_redemptions"("payment_id");
CREATE UNIQUE INDEX "promo_redemptions_promo_code_id_user_id_key" ON "promo_redemptions"("promo_code_id", "user_id");
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_fkey"
    FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "invoice_requests" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company_name" VARCHAR(200) NOT NULL,
    "tax_code" VARCHAR(14) NOT NULL,
    "address" VARCHAR(300) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'Pending',
    "invoice_no" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_at" TIMESTAMPTZ(6),
    CONSTRAINT "invoice_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invoice_requests_payment_id_key" ON "invoice_requests"("payment_id");
CREATE INDEX "idx_invoice_requests_status" ON "invoice_requests"("status");
