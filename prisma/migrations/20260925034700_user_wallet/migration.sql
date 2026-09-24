-- Additive: in-app wallet balance on users + audit ledger.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "wallet_balance" DECIMAL(15, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "wallet_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "payment_id" UUID,
    "type" VARCHAR(30) NOT NULL,
    "amount" DECIMAL(15, 2) NOT NULL,
    "balance_after" DECIMAL(15, 2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transactions_payment_id_key" ON "wallet_transactions"("payment_id");
CREATE INDEX IF NOT EXISTS "idx_wallet_transactions_user_id" ON "wallet_transactions"("user_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_user_id_fkey'
    ) THEN
        ALTER TABLE "wallet_transactions"
            ADD CONSTRAINT "wallet_transactions_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_payment_id_fkey'
    ) THEN
        ALTER TABLE "wallet_transactions"
            ADD CONSTRAINT "wallet_transactions_payment_id_fkey"
            FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
